//! Integration tests for claim links (escrow): run the compiled program inside LiteSVM.
//! Build first (`anchor build`) so `deploy/wallet_program.so` exists.

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{associated_token, associated_token::get_associated_token_address, token},
    litesvm::{
        types::{FailedTransactionMetadata, TransactionMetadata},
        LiteSVM,
    },
    litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    wallet_program::{error::ErrorCode, state::ClaimLink},
};

const NOW: i64 = 1_000_000;
const HOUR: i64 = 3_600;
const SIG_FEE: u64 = 5_000;

type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    sender: Keypair,
    /// Pays transaction fees, like the wallet's relayer does.
    relayer: Keypair,
    /// The throwaway key whose private half is the secret in the link.
    claim_key: Keypair,
    claim: Pubkey,
}

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/wallet_program.so"
        ));
        svm.add_program(wallet_program::id(), bytes).unwrap();

        let (admin, sender, relayer, claim_key) =
            (Keypair::new(), Keypair::new(), Keypair::new(), Keypair::new());
        for k in [&admin, &sender, &relayer] {
            svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
        }
        let claim = claim_pda(&claim_key.pubkey());
        let mut env = Env { svm, admin, sender, relayer, claim_key, claim };
        env.set_time(NOW);
        env
    }

    fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar(&clock);
    }

    fn send(&mut self, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> TxResult {
        let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &self.svm.latest_blockhash());
        let mut signers: Vec<&Keypair> = vec![payer];
        signers.extend_from_slice(extra);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers[..]).unwrap();
        let res = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        res
    }

    fn balance(&self, a: &Pubkey) -> u64 {
        self.svm.get_balance(a).unwrap_or(0)
    }

    fn is_closed(&self, a: &Pubkey) -> bool {
        self.svm.get_account(a).map_or(true, |acc| acc.lamports == 0)
    }

    fn claim_state(&self) -> ClaimLink {
        let data = self.svm.get_account(&self.claim).expect("claim exists").data;
        ClaimLink::try_deserialize(&mut &data[..]).unwrap()
    }

    // ---- SOL links

    fn ix_create_sol(&self, amount: u64, expiry: i64) -> Instruction {
        Instruction::new_with_bytes(
            wallet_program::id(),
            &wallet_program::instruction::CreateSolLink { amount, expiry }.data(),
            wallet_program::accounts::CreateSolLink {
                sender: self.sender.pubkey(),
                claim_key: self.claim_key.pubkey(),
                claim: self.claim,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    fn ix_claim_sol(&self, recipient: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            wallet_program::id(),
            &wallet_program::instruction::ClaimSolLink {}.data(),
            wallet_program::accounts::ClaimSolLink {
                claim_key: self.claim_key.pubkey(),
                claim: self.claim,
                sender: self.sender.pubkey(),
                recipient: *recipient,
            }
            .to_account_metas(None),
        )
    }

    fn ix_refund_sol(&self, signer: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            wallet_program::id(),
            &wallet_program::instruction::RefundSolLink {}.data(),
            wallet_program::accounts::RefundSolLink { sender: *signer, claim: self.claim }
                .to_account_metas(None),
        )
    }

    fn create_sol(&mut self, amount: u64, expiry: i64) -> TxResult {
        let (ix, sender) = (self.ix_create_sol(amount, expiry), self.sender.insecure_clone());
        self.send(&[ix], &sender, &[])
    }

    /// Claim as the relayer would: relayer pays the fee, the claim key signs.
    fn claim_sol(&mut self, recipient: &Pubkey) -> TxResult {
        let ix = self.ix_claim_sol(recipient);
        let (relayer, key) = (self.relayer.insecure_clone(), self.claim_key.insecure_clone());
        self.send(&[ix], &relayer, &[&key])
    }

    // ---- token links

    fn new_mint(&mut self) -> Pubkey {
        CreateMint::new(&mut self.svm, &self.admin).decimals(6).send().unwrap()
    }

    fn funded_token_account(&mut self, mint: &Pubkey, owner: &Pubkey, amount: u64) -> Pubkey {
        let ata = CreateAssociatedTokenAccount::new(&mut self.svm, &self.admin, mint)
            .owner(owner)
            .send()
            .unwrap();
        if amount > 0 {
            MintTo::new(&mut self.svm, &self.admin, mint, &ata, amount).send().unwrap();
        }
        ata
    }

    fn vault(&self, mint: &Pubkey) -> Pubkey {
        get_associated_token_address(&self.claim, mint)
    }

    fn token_balance(&self, account: &Pubkey) -> u64 {
        let data = self.svm.get_account(account).expect("token account exists").data;
        u64::from_le_bytes(data[64..72].try_into().unwrap())
    }

    fn ix_create_token(&self, mint: &Pubkey, amount: u64, expiry: i64) -> Instruction {
        Instruction::new_with_bytes(
            wallet_program::id(),
            &wallet_program::instruction::CreateTokenLink { amount, expiry }.data(),
            wallet_program::accounts::CreateTokenLink {
                sender: self.sender.pubkey(),
                claim_key: self.claim_key.pubkey(),
                mint: *mint,
                claim: self.claim,
                vault: self.vault(mint),
                sender_token: get_associated_token_address(&self.sender.pubkey(), mint),
                token_program: token::ID,
                associated_token_program: associated_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    fn ix_claim_token(&self, mint: &Pubkey, recipient_token: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            wallet_program::id(),
            &wallet_program::instruction::ClaimTokenLink {}.data(),
            wallet_program::accounts::ClaimTokenLink {
                claim_key: self.claim_key.pubkey(),
                claim: self.claim,
                sender: self.sender.pubkey(),
                mint: *mint,
                vault: self.vault(mint),
                recipient_token: *recipient_token,
                token_program: token::ID,
            }
            .to_account_metas(None),
        )
    }

    fn ix_refund_token(&self, mint: &Pubkey, signer: &Pubkey, sender_token: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            wallet_program::id(),
            &wallet_program::instruction::RefundTokenLink {}.data(),
            wallet_program::accounts::RefundTokenLink {
                sender: *signer,
                claim: self.claim,
                mint: *mint,
                vault: self.vault(mint),
                sender_token: *sender_token,
                token_program: token::ID,
            }
            .to_account_metas(None),
        )
    }

    fn create_token(&mut self, mint: &Pubkey, amount: u64, expiry: i64) -> TxResult {
        let (ix, sender) = (self.ix_create_token(mint, amount, expiry), self.sender.insecure_clone());
        self.send(&[ix], &sender, &[])
    }

    fn claim_token(&mut self, mint: &Pubkey, recipient_token: &Pubkey) -> TxResult {
        let ix = self.ix_claim_token(mint, recipient_token);
        let (relayer, key) = (self.relayer.insecure_clone(), self.claim_key.insecure_clone());
        self.send(&[ix], &relayer, &[&key])
    }
}

fn claim_pda(claim_key: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[wallet_program::CLAIM_SEED, claim_key.as_ref()], &wallet_program::id()).0
}

fn assert_custom<T: std::fmt::Debug>(res: Result<T, FailedTransactionMetadata>, code: u32) {
    let err = res.expect_err("expected the transaction to fail");
    let text = format!("{:?}", err.err);
    assert!(text.contains(&format!("Custom({code})")), "expected Custom({code}), got {text}");
}

fn assert_program_error<T: std::fmt::Debug>(res: Result<T, FailedTransactionMetadata>, e: ErrorCode) {
    assert_custom(res, 6000 + e as u32);
}

// ---------------------------------------------------------------- SOL links

#[test]
fn sol_link_full_lifecycle_and_recipient_needs_no_sol() {
    let mut env = Env::new();
    let sender_start = env.balance(&env.sender.pubkey());
    let relayer_start = env.balance(&env.relayer.pubkey());
    let amount = 500_000_000;

    env.create_sol(amount, NOW + HOUR).unwrap();

    // the escrow records the terms and holds the SOL on top of its own rent
    let state = env.claim_state();
    assert_eq!(state.sender, env.sender.pubkey());
    assert_eq!(state.claim_key, env.claim_key.pubkey());
    assert_eq!(state.mint, Pubkey::default());
    assert_eq!((state.amount, state.expiry), (amount, NOW + HOUR));
    let claim_account = env.svm.get_account(&env.claim).unwrap();
    let rent = env.svm.minimum_balance_for_rent_exemption(claim_account.data.len());
    assert_eq!(claim_account.lamports, rent + amount);

    // a brand-new recipient with 0 SOL claims; only the relayer pays the fee
    let recipient = Pubkey::new_unique();
    assert_eq!(env.balance(&recipient), 0);
    env.claim_sol(&recipient).unwrap();

    assert_eq!(env.balance(&recipient), amount);
    assert!(env.is_closed(&env.claim));
    // the sender is out exactly the amount plus their own fee; the escrow's rent came back
    assert_eq!(env.balance(&env.sender.pubkey()), sender_start - amount - SIG_FEE);
    // two signatures (relayer + claim key), both paid by the relayer
    assert_eq!(env.balance(&env.relayer.pubkey()), relayer_start - 2 * SIG_FEE);
}

#[test]
fn sol_link_cannot_be_claimed_twice() {
    let mut env = Env::new();
    env.create_sol(500_000_000, NOW + HOUR).unwrap();
    env.claim_sol(&Pubkey::new_unique()).unwrap();
    assert!(env.claim_sol(&Pubkey::new_unique()).is_err());
}

#[test]
fn sol_link_needs_the_claim_key_to_sign() {
    let mut env = Env::new();
    env.create_sol(500_000_000, NOW + HOUR).unwrap();

    // Someone who knows the claim address but not its private key can't sign as it.
    let mut ix = env.ix_claim_sol(&Pubkey::new_unique());
    ix.accounts[0].is_signer = false;
    let relayer = env.relayer.insecure_clone();
    assert_custom(env.send(&[ix], &relayer, &[]), 3010); // AccountNotSigner

    // A different key signing in the claim key's place doesn't match the escrow's address.
    let impostor = Keypair::new();
    let mut ix = env.ix_claim_sol(&Pubkey::new_unique());
    ix.accounts[0].pubkey = impostor.pubkey();
    assert!(env.send(&[ix], &relayer, &[&impostor]).is_err());
    assert!(!env.is_closed(&env.claim));
}

#[test]
fn sol_link_cannot_be_claimed_after_expiry_but_can_be_refunded() {
    let mut env = Env::new();
    let sender_start = env.balance(&env.sender.pubkey());
    env.create_sol(500_000_000, NOW + HOUR).unwrap();

    env.set_time(NOW + HOUR + 1);
    assert_program_error(env.claim_sol(&Pubkey::new_unique()), ErrorCode::ClaimExpired);

    let (ix, sender) = (env.ix_refund_sol(&env.sender.pubkey()), env.sender.insecure_clone());
    env.send(&[ix], &sender, &[]).unwrap();
    assert!(env.is_closed(&env.claim));
    // everything back except the two transaction fees
    assert_eq!(env.balance(&env.sender.pubkey()), sender_start - 2 * SIG_FEE);
}

#[test]
fn claiming_exactly_at_expiry_still_works() {
    let mut env = Env::new();
    env.create_sol(500_000_000, NOW + HOUR).unwrap();
    env.set_time(NOW + HOUR);
    env.claim_sol(&Pubkey::new_unique()).unwrap();
}

#[test]
fn sender_can_cancel_before_expiry_and_only_the_sender() {
    let mut env = Env::new();
    env.create_sol(500_000_000, NOW + HOUR).unwrap();

    let attacker = Keypair::new();
    env.svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();
    let ix = env.ix_refund_sol(&attacker.pubkey());
    assert!(env.send(&[ix], &attacker, &[]).is_err());
    assert!(!env.is_closed(&env.claim));

    let (ix, sender) = (env.ix_refund_sol(&env.sender.pubkey()), env.sender.insecure_clone());
    env.send(&[ix], &sender, &[]).unwrap();
    assert!(env.is_closed(&env.claim));
    // once cancelled, the link is dead
    assert!(env.claim_sol(&Pubkey::new_unique()).is_err());
}

#[test]
fn sol_link_creation_is_validated() {
    let mut env = Env::new();
    // expiry must be in the future
    assert_program_error(env.create_sol(500_000_000, NOW), ErrorCode::InvalidExpiry);
    // the payout must be enough to open a new account
    let min = env.svm.minimum_balance_for_rent_exemption(0);
    assert_program_error(env.create_sol(min - 1, NOW + HOUR), ErrorCode::AmountTooSmall);
    env.create_sol(min, NOW + HOUR).unwrap();
    // and the same claim key can't be used twice
    assert!(env.create_sol(min, NOW + HOUR).is_err());
}

// ---------------------------------------------------------------- token links

#[test]
fn token_link_full_lifecycle() {
    let mut env = Env::new();
    let mint = env.new_mint();
    let sender_token = env.funded_token_account(&mint, &env.sender.pubkey(), 1_000_000);

    env.create_token(&mint, 400_000, NOW + HOUR).unwrap();
    assert_eq!(env.token_balance(&sender_token), 600_000);
    assert_eq!(env.token_balance(&env.vault(&mint)), 400_000);
    let state = env.claim_state();
    assert_eq!((state.mint, state.amount), (mint, 400_000));

    // recipient's token account exists (the client creates it in the same transaction)
    let recipient = Pubkey::new_unique();
    let recipient_token = env.funded_token_account(&mint, &recipient, 0);
    env.claim_token(&mint, &recipient_token).unwrap();

    assert_eq!(env.token_balance(&recipient_token), 400_000);
    assert!(env.is_closed(&env.claim));
    assert!(env.is_closed(&env.vault(&mint)));
    assert_eq!(env.balance(&recipient), 0); // the recipient never needed SOL
}

#[test]
fn token_link_refund_returns_tokens_and_closes_everything() {
    let mut env = Env::new();
    let mint = env.new_mint();
    let sender_token = env.funded_token_account(&mint, &env.sender.pubkey(), 1_000_000);
    env.create_token(&mint, 400_000, NOW + HOUR).unwrap();

    let (ix, sender) = (
        env.ix_refund_token(&mint, &env.sender.pubkey(), &sender_token),
        env.sender.insecure_clone(),
    );
    env.send(&[ix], &sender, &[]).unwrap();

    assert_eq!(env.token_balance(&sender_token), 1_000_000);
    assert!(env.is_closed(&env.claim) && env.is_closed(&env.vault(&mint)));
}

#[test]
fn token_link_expiry_blocks_claims_only() {
    let mut env = Env::new();
    let mint = env.new_mint();
    let sender_token = env.funded_token_account(&mint, &env.sender.pubkey(), 1_000_000);
    let recipient_token = env.funded_token_account(&mint, &Pubkey::new_unique(), 0);
    env.create_token(&mint, 400_000, NOW + HOUR).unwrap();

    env.set_time(NOW + HOUR + 1);
    assert_program_error(env.claim_token(&mint, &recipient_token), ErrorCode::ClaimExpired);
    assert_eq!(env.token_balance(&recipient_token), 0);

    let (ix, sender) = (
        env.ix_refund_token(&mint, &env.sender.pubkey(), &sender_token),
        env.sender.insecure_clone(),
    );
    env.send(&[ix], &sender, &[]).unwrap();
    assert_eq!(env.token_balance(&sender_token), 1_000_000);
}

#[test]
fn a_stray_donation_to_the_vault_cannot_block_the_claim() {
    let mut env = Env::new();
    let mint = env.new_mint();
    env.funded_token_account(&mint, &env.sender.pubkey(), 1_000_000);
    let recipient_token = env.funded_token_account(&mint, &Pubkey::new_unique(), 0);
    env.create_token(&mint, 400_000, NOW + HOUR).unwrap();

    // someone sends extra tokens straight to the vault; closing it would fail if we ignored them
    let vault = env.vault(&mint);
    MintTo::new(&mut env.svm, &env.admin, &mint, &vault, 50).send().unwrap();

    env.claim_token(&mint, &recipient_token).unwrap();
    assert_eq!(env.token_balance(&recipient_token), 400_050);
    assert!(env.is_closed(&vault));
}

#[test]
fn token_link_cannot_be_claimed_with_the_wrong_mint_or_key() {
    let mut env = Env::new();
    let mint = env.new_mint();
    let other_mint = env.new_mint();
    env.funded_token_account(&mint, &env.sender.pubkey(), 1_000_000);
    env.create_token(&mint, 400_000, NOW + HOUR).unwrap();

    // a token account of a different mint is rejected
    let wrong = env.funded_token_account(&other_mint, &Pubkey::new_unique(), 0);
    assert!(env.claim_token(&mint, &wrong).is_err());

    // without the claim key's signature
    let recipient_token = env.funded_token_account(&mint, &Pubkey::new_unique(), 0);
    let mut ix = env.ix_claim_token(&mint, &recipient_token);
    ix.accounts[0].is_signer = false;
    let relayer = env.relayer.insecure_clone();
    assert_custom(env.send(&[ix], &relayer, &[]), 3010);
    assert_eq!(env.token_balance(&env.vault(&mint)), 400_000);
}

#[test]
fn token_link_validation() {
    let mut env = Env::new();
    let mint = env.new_mint();
    env.funded_token_account(&mint, &env.sender.pubkey(), 1_000_000);
    assert_program_error(env.create_token(&mint, 0, NOW + HOUR), ErrorCode::ZeroAmount);
    assert_program_error(env.create_token(&mint, 1, NOW - 1), ErrorCode::InvalidExpiry);
    // more than the sender holds
    assert!(env.create_token(&mint, 2_000_000, NOW + HOUR).is_err());
}

// ---------------------------------------------------------------- mixing link types

#[test]
fn link_types_cannot_be_mixed_up() {
    let mut env = Env::new();
    let mint = env.new_mint();
    let sender_token = env.funded_token_account(&mint, &env.sender.pubkey(), 1_000_000);
    env.create_token(&mint, 400_000, NOW + HOUR).unwrap();

    // The SOL refund/claim paths would close the escrow account and strand the vault's tokens.
    let sender = env.sender.insecure_clone();
    let ix = env.ix_refund_sol(&sender.pubkey());
    assert_program_error(env.send(&[ix], &sender, &[]), ErrorCode::LinkTypeMismatch);
    assert_program_error(env.claim_sol(&Pubkey::new_unique()), ErrorCode::LinkTypeMismatch);
    assert_eq!(env.token_balance(&env.vault(&mint)), 400_000);

    // ...and the token paths reject a SOL link
    let mut env2 = Env::new();
    env2.create_sol(500_000_000, NOW + HOUR).unwrap();
    let ix = env2.ix_refund_token(&mint, &env2.sender.pubkey(), &sender_token);
    let sender2 = env2.sender.insecure_clone();
    assert!(env2.send(&[ix], &sender2, &[]).is_err());
    assert!(!env2.is_closed(&env2.claim));
}
