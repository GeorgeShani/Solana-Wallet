//! Integration tests for timelocks and stealth announcements, run inside LiteSVM.
//! Build first (`anchor build`) so `deploy/wallet_program.so` exists.

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, Discriminator, InstructionData, ToAccountMetas,
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
    wallet_program::{error::ErrorCode, state::Timelock, StealthAnnouncement},
};

const NOW: i64 = 1_000_000;
type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    sender: Keypair,
    recipient: Keypair,
    mint: Pubkey,
    sender_token: Pubkey,
    recipient_token: Pubkey,
}

fn timelock_pda(sender: &Pubkey, recipient: &Pubkey, seed: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[wallet_program::TIMELOCK_SEED, sender.as_ref(), recipient.as_ref(), &seed.to_le_bytes()],
        &wallet_program::id(),
    )
    .0
}

impl Env {
    /// A sender holding 1,000,000 tokens and a recipient with an (empty) token account.
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/wallet_program.so"));
        svm.add_program(wallet_program::id(), bytes).unwrap();

        let (admin, sender, recipient) = (Keypair::new(), Keypair::new(), Keypair::new());
        for k in [&admin, &sender, &recipient] {
            svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
        }
        let mint = CreateMint::new(&mut svm, &admin).decimals(6).send().unwrap();
        let sender_token = CreateAssociatedTokenAccount::new(&mut svm, &admin, &mint)
            .owner(&sender.pubkey())
            .send()
            .unwrap();
        MintTo::new(&mut svm, &admin, &mint, &sender_token, 1_000_000).send().unwrap();
        let recipient_token = CreateAssociatedTokenAccount::new(&mut svm, &admin, &mint)
            .owner(&recipient.pubkey())
            .send()
            .unwrap();

        let mut env = Env { svm, admin, sender, recipient, mint, sender_token, recipient_token };
        env.set_time(NOW);
        env
    }

    fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar(&clock);
    }

    fn send(&mut self, ixs: &[Instruction], payer: &Keypair) -> TxResult {
        let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &self.svm.latest_blockhash());
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
        let res = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        res
    }

    fn pda(&self, seed: u64) -> Pubkey {
        timelock_pda(&self.sender.pubkey(), &self.recipient.pubkey(), seed)
    }

    fn vault(&self, seed: u64) -> Pubkey {
        get_associated_token_address(&self.pda(seed), &self.mint)
    }

    fn balance(&self, a: &Pubkey) -> u64 {
        self.svm.get_balance(a).unwrap_or(0)
    }

    fn token_balance(&self, a: &Pubkey) -> u64 {
        let d = self.svm.get_account(a).expect("token account exists").data;
        u64::from_le_bytes(d[64..72].try_into().unwrap())
    }

    fn is_closed(&self, a: &Pubkey) -> bool {
        self.svm.get_account(a).map_or(true, |acc| acc.lamports == 0)
    }

    fn state(&self, seed: u64) -> Timelock {
        let data = self.svm.get_account(&self.pda(seed)).expect("timelock exists").data;
        Timelock::try_deserialize(&mut &data[..]).unwrap()
    }

    fn ix_create(&self, seed: u64, amount: u64, start: i64, cliff: i64, end: i64, cancellable: bool) -> Instruction {
        Instruction::new_with_bytes(
            wallet_program::id(),
            &wallet_program::instruction::CreateTimelock { seed, amount, start, cliff, end, cancellable }.data(),
            wallet_program::accounts::CreateTimelock {
                sender: self.sender.pubkey(),
                recipient: self.recipient.pubkey(),
                mint: self.mint,
                timelock: self.pda(seed),
                vault: self.vault(seed),
                sender_token: self.sender_token,
                token_program: token::ID,
                associated_token_program: associated_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    fn create(&mut self, seed: u64, amount: u64, start: i64, cliff: i64, end: i64, cancellable: bool) -> TxResult {
        let (ix, sender) = (self.ix_create(seed, amount, start, cliff, end, cancellable), self.sender.insecure_clone());
        self.send(&[ix], &sender)
    }

    fn ix_withdraw(&self, seed: u64) -> Instruction {
        Instruction::new_with_bytes(
            wallet_program::id(),
            &wallet_program::instruction::WithdrawTimelock {}.data(),
            wallet_program::accounts::WithdrawTimelock {
                recipient: self.recipient.pubkey(),
                timelock: self.pda(seed),
                sender: self.sender.pubkey(),
                mint: self.mint,
                vault: self.vault(seed),
                recipient_token: self.recipient_token,
                token_program: token::ID,
            }
            .to_account_metas(None),
        )
    }

    fn withdraw(&mut self, seed: u64) -> TxResult {
        let (ix, recipient) = (self.ix_withdraw(seed), self.recipient.insecure_clone());
        self.send(&[ix], &recipient)
    }

    fn ix_cancel(&self, seed: u64) -> Instruction {
        Instruction::new_with_bytes(
            wallet_program::id(),
            &wallet_program::instruction::CancelTimelock {}.data(),
            wallet_program::accounts::CancelTimelock {
                sender: self.sender.pubkey(),
                timelock: self.pda(seed),
                mint: self.mint,
                vault: self.vault(seed),
                sender_token: self.sender_token,
                token_program: token::ID,
            }
            .to_account_metas(None),
        )
    }

    fn cancel(&mut self, seed: u64) -> TxResult {
        let (ix, sender) = (self.ix_cancel(seed), self.sender.insecure_clone());
        self.send(&[ix], &sender)
    }
}

fn assert_program_error<T: std::fmt::Debug>(res: Result<T, FailedTransactionMetadata>, e: ErrorCode) {
    let err = res.expect_err("expected the transaction to fail");
    let text = format!("{:?}", err.err);
    let want = format!("Custom({})", 6000 + e as u32);
    assert!(text.contains(&want), "expected {want} ({e:?}), got {text}");
}

// ---------------------------------------------------------------- creating

#[test]
fn create_locks_the_tokens_and_records_the_schedule() {
    let mut env = Env::new();
    env.create(7, 1_000, NOW, NOW + 100, NOW + 1_000, true).unwrap();

    assert_eq!(env.token_balance(&env.sender_token), 1_000_000 - 1_000);
    assert_eq!(env.token_balance(&env.vault(7)), 1_000);
    let t = env.state(7);
    assert_eq!((t.sender, t.recipient, t.mint), (env.sender.pubkey(), env.recipient.pubkey(), env.mint));
    assert_eq!((t.seed, t.total, t.withdrawn), (7, 1_000, 0));
    assert_eq!((t.start, t.cliff, t.end, t.cancellable), (NOW, NOW + 100, NOW + 1_000, true));
}

#[test]
fn a_schedule_must_be_ordered_and_end_in_the_future() {
    let mut env = Env::new();
    // cliff before start
    assert_program_error(env.create(1, 1_000, NOW + 10, NOW, NOW + 1_000, true), ErrorCode::InvalidSchedule);
    // end before cliff
    assert_program_error(env.create(1, 1_000, NOW, NOW + 500, NOW + 400, true), ErrorCode::InvalidSchedule);
    // already over
    assert_program_error(env.create(1, 1_000, NOW - 100, NOW - 100, NOW, true), ErrorCode::InvalidSchedule);
    assert_program_error(env.create(1, 0, NOW, NOW, NOW + 100, true), ErrorCode::ZeroAmount);
    // nothing was locked by any of the failed attempts
    assert_eq!(env.token_balance(&env.sender_token), 1_000_000);
}

#[test]
fn one_sender_can_lock_several_amounts_for_the_same_recipient() {
    let mut env = Env::new();
    env.create(1, 1_000, NOW, NOW, NOW + 100, true).unwrap();
    env.create(2, 2_000, NOW, NOW, NOW + 100, true).unwrap();
    assert_eq!(env.token_balance(&env.vault(1)), 1_000);
    assert_eq!(env.token_balance(&env.vault(2)), 2_000);
    // ...but not reuse a seed
    assert!(env.create(1, 5, NOW, NOW, NOW + 100, true).is_err());
}

// ---------------------------------------------------------------- withdrawing

#[test]
fn linear_vesting_pays_in_installments_and_closes_at_the_end() {
    let mut env = Env::new();
    let sender_lamports = env.balance(&env.sender.pubkey());
    env.create(1, 1_000, NOW, NOW, NOW + 1_000, false).unwrap();
    let sender_after_create = env.balance(&env.sender.pubkey());
    assert!(sender_after_create < sender_lamports); // paid the accounts' rent

    env.set_time(NOW + 250);
    env.withdraw(1).unwrap();
    assert_eq!(env.token_balance(&env.recipient_token), 250);
    assert_eq!(env.state(1).withdrawn, 250);

    // taking it again straight away has nothing to give
    assert_program_error(env.withdraw(1), ErrorCode::NothingToWithdraw);

    env.set_time(NOW + 500);
    env.withdraw(1).unwrap();
    assert_eq!(env.token_balance(&env.recipient_token), 500);

    env.set_time(NOW + 1_000);
    env.withdraw(1).unwrap();
    assert_eq!(env.token_balance(&env.recipient_token), 1_000);

    // done: both accounts closed and their rent returned to the sender
    assert!(env.is_closed(&env.pda(1)) && env.is_closed(&env.vault(1)));
    let refunded = env.balance(&env.sender.pubkey()) - sender_after_create;
    assert!(refunded > 2_000_000, "rent was not returned to the sender: {refunded}");
}

#[test]
fn a_cliff_holds_everything_back_then_releases_the_accrued_share() {
    let mut env = Env::new();
    env.create(1, 1_000, NOW, NOW + 500, NOW + 1_000, false).unwrap();
    env.set_time(NOW + 499);
    assert_program_error(env.withdraw(1), ErrorCode::NothingToWithdraw);
    env.set_time(NOW + 500);
    env.withdraw(1).unwrap();
    assert_eq!(env.token_balance(&env.recipient_token), 500); // the half that accrued since `start`
}

#[test]
fn unlock_on_a_date_is_all_or_nothing() {
    let mut env = Env::new();
    let date = NOW + 3_600;
    env.create(1, 5_000, date, date, date, false).unwrap();
    env.set_time(date - 1);
    assert_program_error(env.withdraw(1), ErrorCode::NothingToWithdraw);
    env.set_time(date);
    env.withdraw(1).unwrap();
    assert_eq!(env.token_balance(&env.recipient_token), 5_000);
    assert!(env.is_closed(&env.pda(1)));
}

#[test]
fn a_stray_donation_to_the_vault_cannot_block_the_final_withdrawal() {
    let mut env = Env::new();
    env.create(1, 1_000, NOW, NOW, NOW + 100, false).unwrap();
    let vault = env.vault(1);
    MintTo::new(&mut env.svm, &env.admin, &env.mint, &vault, 77).send().unwrap();
    env.set_time(NOW + 100);
    env.withdraw(1).unwrap();
    assert_eq!(env.token_balance(&env.recipient_token), 1_077);
    assert!(env.is_closed(&vault));
}

#[test]
fn only_the_recipient_can_withdraw_and_only_to_their_own_account() {
    let mut env = Env::new();
    env.create(1, 1_000, NOW, NOW, NOW + 100, false).unwrap();
    env.set_time(NOW + 100);

    // the recipient's address, but without their signature
    let mut ix = env.ix_withdraw(1);
    ix.accounts[0].is_signer = false;
    let attacker = Keypair::new();
    env.svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();
    assert!(env.send(&[ix], &attacker).is_err());

    // an impostor signing in the recipient's place
    let mut ix = env.ix_withdraw(1);
    ix.accounts[0].pubkey = attacker.pubkey();
    assert!(env.send(&[ix], &attacker).is_err());

    // the recipient signing, but paying out to someone else's token account
    let attacker_token = CreateAssociatedTokenAccount::new(&mut env.svm, &env.admin, &env.mint)
        .owner(&attacker.pubkey())
        .send()
        .unwrap();
    let mut ix = env.ix_withdraw(1);
    ix.accounts[5].pubkey = attacker_token; // recipient_token slot
    let recipient = env.recipient.insecure_clone();
    assert!(env.send(&[ix], &recipient).is_err());

    assert_eq!(env.token_balance(&env.vault(1)), 1_000); // nothing moved
}

// ---------------------------------------------------------------- cancelling

#[test]
fn cancelling_returns_the_unvested_part_and_freezes_what_was_earned() {
    let mut env = Env::new();
    env.create(1, 1_000, NOW, NOW, NOW + 1_000, true).unwrap();

    env.set_time(NOW + 250);
    env.withdraw(1).unwrap(); // recipient already took 250
    env.set_time(NOW + 400);
    env.cancel(1).unwrap();

    // 400 had vested: 250 taken, 150 still owed. The other 600 went back to the sender.
    assert_eq!(env.token_balance(&env.sender_token), 1_000_000 - 1_000 + 600);
    assert_eq!(env.token_balance(&env.vault(1)), 150);
    let t = env.state(1);
    assert_eq!((t.total, t.withdrawn, t.cancellable), (400, 250, false));

    // the schedule is frozen: the owed 150 is available at once, and no more ever accrues
    env.set_time(NOW + 401);
    env.withdraw(1).unwrap();
    assert_eq!(env.token_balance(&env.recipient_token), 400);
    assert!(env.is_closed(&env.pda(1)) && env.is_closed(&env.vault(1)));
}

#[test]
fn cancelling_before_the_cliff_refunds_everything_and_closes() {
    let mut env = Env::new();
    env.create(1, 1_000, NOW, NOW + 500, NOW + 1_000, true).unwrap();
    env.set_time(NOW + 100);
    env.cancel(1).unwrap();
    assert_eq!(env.token_balance(&env.sender_token), 1_000_000);
    assert!(env.is_closed(&env.pda(1)) && env.is_closed(&env.vault(1)));
}

#[test]
fn a_non_cancellable_timelock_cannot_be_cancelled() {
    let mut env = Env::new();
    env.create(1, 1_000, NOW, NOW, NOW + 1_000, false).unwrap();
    assert_program_error(env.cancel(1), ErrorCode::NotCancellable);
    assert_eq!(env.token_balance(&env.vault(1)), 1_000);
}

#[test]
fn a_timelock_can_only_be_cancelled_once_and_only_by_the_sender() {
    let mut env = Env::new();
    env.create(1, 1_000, NOW, NOW, NOW + 1_000, true).unwrap();
    env.set_time(NOW + 400);

    // the recipient can't cancel the sender's timelock
    let mut ix = env.ix_cancel(1);
    ix.accounts[0].pubkey = env.recipient.pubkey();
    let recipient = env.recipient.insecure_clone();
    assert!(env.send(&[ix], &recipient).is_err());

    env.cancel(1).unwrap();
    assert_program_error(env.cancel(1), ErrorCode::NotCancellable); // frozen schedules are final
}

// ---------------------------------------------------------------- stealth announcements

/// Minimal base64 decoder for the `Program data:` log line.
fn b64(s: &str) -> Vec<u8> {
    let val = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        b'/' => 63,
        _ => 255,
    };
    let (mut out, mut buf, mut bits) = (Vec::new(), 0u32, 0);
    for c in s.bytes().filter(|c| *c != b'=') {
        buf = (buf << 6) | val(c) as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    out
}

#[test]
fn announce_emits_the_ephemeral_key_stealth_address_and_view_tag() {
    let mut env = Env::new();
    let (ephemeral, stealth) = (Pubkey::new_unique(), Pubkey::new_unique());
    let ix = Instruction::new_with_bytes(
        wallet_program::id(),
        &wallet_program::instruction::Announce { ephemeral, stealth, view_tag: 0xAB }.data(),
        wallet_program::accounts::Announce { payer: env.sender.pubkey() }.to_account_metas(None),
    );
    let sender = env.sender.insecure_clone();
    let meta = env.send(&[ix], &sender).unwrap();

    let data = meta
        .logs
        .iter()
        .find_map(|l| l.strip_prefix("Program data: "))
        .map(b64)
        .expect("an event was emitted");
    assert_eq!(&data[..8], StealthAnnouncement::DISCRIMINATOR);
    assert_eq!(&data[8..40], ephemeral.as_ref());
    assert_eq!(&data[40..72], stealth.as_ref());
    assert_eq!(data[72], 0xAB);
    assert_eq!(data.len(), 73);
    // the announcement does not carry the sender
    assert!(!data.windows(32).any(|w| w == sender.pubkey().as_ref()));
}
