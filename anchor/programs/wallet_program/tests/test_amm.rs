//! Integration tests: run the compiled program inside LiteSVM.
//! Build first (`anchor build`) so `deploy/wallet_program.so` exists.

use {
    anchor_lang::{
        prelude::Pubkey,
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
    wallet_program::{error::ErrorCode, math, state::Pool, MINIMUM_LIQUIDITY},
};

const FEE_BPS: u16 = 30;

type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    mint_a: Pubkey,
    mint_b: Pubkey,
    pool: Pubkey,
    lp_mint: Pubkey,
    vault_a: Pubkey,
    vault_b: Pubkey,
}

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/wallet_program.so"
        ));
        svm.add_program(wallet_program::id(), bytes).unwrap();

        let admin = Keypair::new();
        svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();

        let m1 = CreateMint::new(&mut svm, &admin).decimals(6).send().unwrap();
        let m2 = CreateMint::new(&mut svm, &admin).decimals(6).send().unwrap();
        let (mint_a, mint_b) = if m1 < m2 { (m1, m2) } else { (m2, m1) };

        let (pool, _) = Pubkey::find_program_address(
            &[wallet_program::POOL_SEED, mint_a.as_ref(), mint_b.as_ref()],
            &wallet_program::id(),
        );
        let (lp_mint, _) = Pubkey::find_program_address(
            &[wallet_program::LP_MINT_SEED, pool.as_ref()],
            &wallet_program::id(),
        );
        Env {
            vault_a: get_associated_token_address(&pool, &mint_a),
            vault_b: get_associated_token_address(&pool, &mint_b),
            svm,
            admin,
            mint_a,
            mint_b,
            pool,
            lp_mint,
        }
    }

    fn send(&mut self, ixs: &[Instruction], payer: &Keypair) -> TxResult {
        let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &self.svm.latest_blockhash());
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
        let res = self.svm.send_transaction(tx);
        // Fresh blockhash so identical consecutive transactions aren't rejected as duplicates.
        self.svm.expire_blockhash();
        res
    }

    fn init_pool(&mut self, fee_bps: u16) -> TxResult {
        let ix = self.ix_init_pool(self.mint_a, self.mint_b, fee_bps);
        let admin = self.admin.insecure_clone();
        self.send(&[ix], &admin)
    }

    fn ix_init_pool(&self, mint_a: Pubkey, mint_b: Pubkey, fee_bps: u16) -> Instruction {
        let (pool, _) = Pubkey::find_program_address(
            &[wallet_program::POOL_SEED, mint_a.as_ref(), mint_b.as_ref()],
            &wallet_program::id(),
        );
        let (lp_mint, _) = Pubkey::find_program_address(
            &[wallet_program::LP_MINT_SEED, pool.as_ref()],
            &wallet_program::id(),
        );
        Instruction::new_with_bytes(
            wallet_program::id(),
            &wallet_program::instruction::InitPool { fee_bps }.data(),
            wallet_program::accounts::InitPool {
                payer: self.admin.pubkey(),
                mint_a,
                mint_b,
                pool,
                lp_mint,
                vault_a: get_associated_token_address(&pool, &mint_a),
                vault_b: get_associated_token_address(&pool, &mint_b),
                token_program: token::ID,
                associated_token_program: associated_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    /// A funded user holding `amount_a` of mint A and `amount_b` of mint B.
    fn new_user(&mut self, amount_a: u64, amount_b: u64) -> Keypair {
        let user = Keypair::new();
        self.svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
        for (mint, amount) in [(self.mint_a, amount_a), (self.mint_b, amount_b)] {
            let ata = CreateAssociatedTokenAccount::new(&mut self.svm, &self.admin, &mint)
                .owner(&user.pubkey())
                .send()
                .unwrap();
            if amount > 0 {
                MintTo::new(&mut self.svm, &self.admin, &mint, &ata, amount).send().unwrap();
            }
        }
        user
    }

    /// LP token accounts can only exist once the pool (and its LP mint) does.
    fn create_lp_account(&mut self, user: &Keypair) {
        CreateAssociatedTokenAccount::new(&mut self.svm, &self.admin, &self.lp_mint)
            .owner(&user.pubkey())
            .send()
            .unwrap();
    }

    fn liquidity_accounts(&self, user: &Pubkey) -> wallet_program::accounts::Liquidity {
        wallet_program::accounts::Liquidity {
            user: *user,
            pool: self.pool,
            mint_a: self.mint_a,
            mint_b: self.mint_b,
            lp_mint: self.lp_mint,
            vault_a: self.vault_a,
            vault_b: self.vault_b,
            user_a: self.ata(user, &self.mint_a),
            user_b: self.ata(user, &self.mint_b),
            user_lp: self.ata(user, &self.lp_mint),
            token_program: token::ID,
            associated_token_program: associated_token::ID,
        }
    }

    fn ix_add(&self, user: &Pubkey, a: u64, b: u64, min_lp: u64) -> Instruction {
        Instruction::new_with_bytes(
            wallet_program::id(),
            &wallet_program::instruction::AddLiquidity {
                amount_a_desired: a,
                amount_b_desired: b,
                min_lp,
            }
            .data(),
            self.liquidity_accounts(user).to_account_metas(None),
        )
    }

    fn ix_remove(&self, user: &Pubkey, lp: u64, min_a: u64, min_b: u64) -> Instruction {
        Instruction::new_with_bytes(
            wallet_program::id(),
            &wallet_program::instruction::RemoveLiquidity {
                lp_amount: lp,
                min_amount_a: min_a,
                min_amount_b: min_b,
            }
            .data(),
            self.liquidity_accounts(user).to_account_metas(None),
        )
    }

    fn ix_swap(&self, user: &Pubkey, amount_in: u64, min_out: u64, a_to_b: bool) -> Instruction {
        Instruction::new_with_bytes(
            wallet_program::id(),
            &wallet_program::instruction::Swap {
                amount_in,
                min_amount_out: min_out,
                a_to_b,
            }
            .data(),
            wallet_program::accounts::Swap {
                user: *user,
                pool: self.pool,
                mint_a: self.mint_a,
                mint_b: self.mint_b,
                vault_a: self.vault_a,
                vault_b: self.vault_b,
                user_a: self.ata(user, &self.mint_a),
                user_b: self.ata(user, &self.mint_b),
                token_program: token::ID,
            }
            .to_account_metas(None),
        )
    }

    fn ata(&self, owner: &Pubkey, mint: &Pubkey) -> Pubkey {
        get_associated_token_address(owner, mint)
    }

    /// Token balance (amount lives at bytes 64..72 of an SPL token account).
    fn bal(&self, account: &Pubkey) -> u64 {
        let data = self.svm.get_account(account).expect("account exists").data;
        u64::from_le_bytes(data[64..72].try_into().unwrap())
    }

    fn user_bal(&self, user: &Keypair, mint: &Pubkey) -> u64 {
        self.bal(&self.ata(&user.pubkey(), mint))
    }

    /// LP mint supply (bytes 36..44 of an SPL mint).
    fn lp_supply(&self) -> u64 {
        let data = self.svm.get_account(&self.lp_mint).unwrap().data;
        u64::from_le_bytes(data[36..44].try_into().unwrap())
    }

    /// Pool created and seeded by a liquidity provider. Returns (env, provider).
    fn with_liquidity(reserve_a: u64, reserve_b: u64) -> (Env, Keypair) {
        let mut env = Env::new();
        env.init_pool(FEE_BPS).unwrap();
        let lp = env.new_user(reserve_a, reserve_b);
        env.create_lp_account(&lp);
        let ix = env.ix_add(&lp.pubkey(), reserve_a, reserve_b, 0);
        env.send(&[ix], &lp).unwrap();
        (env, lp)
    }
}

fn assert_program_error(res: TxResult, code: ErrorCode) {
    let err = res.expect_err("expected the transaction to fail");
    let text = format!("{:?}", err.err);
    let want = format!("Custom({})", 6000 + code as u32);
    assert!(text.contains(&want), "expected {want} ({code:?}), got {text}");
}

// ---------------------------------------------------------------- pool creation

#[test]
fn init_pool_creates_pool_vaults_and_lp_mint() {
    let mut env = Env::new();
    env.init_pool(FEE_BPS).unwrap();

    let data = env.svm.get_account(&env.pool).unwrap().data;
    let pool = Pool::try_deserialize(&mut &data[..]).unwrap();
    assert_eq!(pool.mint_a, env.mint_a);
    assert_eq!(pool.mint_b, env.mint_b);
    assert_eq!(pool.lp_mint, env.lp_mint);
    assert_eq!(pool.fee_bps, FEE_BPS);

    // vaults are owned (token-owner field, bytes 32..64) by the pool PDA and start empty
    for vault in [env.vault_a, env.vault_b] {
        let d = env.svm.get_account(&vault).unwrap().data;
        assert_eq!(&d[32..64], env.pool.as_ref());
        assert_eq!(env.bal(&vault), 0);
    }
    // LP mint: authority (COption tag 4 bytes, then key) is the pool, 9 decimals, no supply
    let m = env.svm.get_account(&env.lp_mint).unwrap().data;
    assert_eq!(&m[4..36], env.pool.as_ref());
    assert_eq!(m[44], 9);
    assert_eq!(env.lp_supply(), 0);
}

#[test]
fn init_pool_rejects_unsorted_mints() {
    let mut env = Env::new();
    let ix = env.ix_init_pool(env.mint_b, env.mint_a, FEE_BPS); // swapped
    let admin = env.admin.insecure_clone();
    assert_program_error(env.send(&[ix], &admin), ErrorCode::UnsortedMints);
}

#[test]
fn init_pool_rejects_excessive_fee() {
    let mut env = Env::new();
    assert_program_error(env.init_pool(1_001), ErrorCode::InvalidFee);
    env.init_pool(1_000).unwrap(); // the maximum is allowed
}

#[test]
fn init_pool_twice_fails() {
    let mut env = Env::new();
    env.init_pool(FEE_BPS).unwrap();
    assert!(env.init_pool(FEE_BPS).is_err());
}

// ---------------------------------------------------------------- liquidity

#[test]
fn first_deposit_sets_the_price_and_locks_minimum_liquidity() {
    let (env, lp) = Env::with_liquidity(4_000_000_000, 1_000_000_000);
    // sqrt(4e9 * 1e9) = 2e9 shares, of which 1_000 are locked forever
    assert_eq!(env.user_bal(&lp, &env.lp_mint), 2_000_000_000 - MINIMUM_LIQUIDITY);
    assert_eq!(env.lp_supply(), 2_000_000_000 - MINIMUM_LIQUIDITY);
    assert_eq!(env.bal(&env.vault_a), 4_000_000_000);
    assert_eq!(env.bal(&env.vault_b), 1_000_000_000);
    assert_eq!(env.user_bal(&lp, &env.mint_a), 0);
}

#[test]
fn second_deposit_takes_the_pool_ratio_and_mints_proportional_lp() {
    let (mut env, _) = Env::with_liquidity(4_000_000_000, 1_000_000_000);
    let user = env.new_user(1_000_000_000, 1_000_000_000);
    env.create_lp_account(&user);

    // offers 400M A and up to 1B B; the pool is 4:1 so it only takes 100M B
    let ix = env.ix_add(&user.pubkey(), 400_000_000, 1_000_000_000, 0);
    env.send(&[ix], &user).unwrap();

    assert_eq!(env.user_bal(&user, &env.mint_a), 600_000_000);
    assert_eq!(env.user_bal(&user, &env.mint_b), 900_000_000);
    assert_eq!(env.user_bal(&user, &env.lp_mint), 200_000_000); // 10% of 2e9 shares
    assert_eq!(env.bal(&env.vault_a), 4_400_000_000);
    assert_eq!(env.bal(&env.vault_b), 1_100_000_000);
}

#[test]
fn add_liquidity_enforces_min_lp() {
    let (mut env, _) = Env::with_liquidity(1_000_000_000, 1_000_000_000);
    let user = env.new_user(100_000_000, 100_000_000);
    env.create_lp_account(&user);
    let ix = env.ix_add(&user.pubkey(), 100_000_000, 100_000_000, u64::MAX);
    assert_program_error(env.send(&[ix], &user), ErrorCode::SlippageExceeded);
    assert_eq!(env.user_bal(&user, &env.mint_a), 100_000_000); // nothing moved
}

#[test]
fn tiny_first_deposit_is_rejected() {
    let mut env = Env::new();
    env.init_pool(FEE_BPS).unwrap();
    let user = env.new_user(1_000, 1_000);
    env.create_lp_account(&user);
    let ix = env.ix_add(&user.pubkey(), 1_000, 1_000, 0); // sqrt = 1_000, not > minimum
    assert_program_error(env.send(&[ix], &user), ErrorCode::InitialDepositTooSmall);
}

#[test]
fn remove_liquidity_returns_the_proportional_share() {
    let (mut env, lp) = Env::with_liquidity(4_000_000_000, 1_000_000_000);
    let half = env.user_bal(&lp, &env.lp_mint) / 2; // 999_999_500

    let ix = env.ix_remove(&lp.pubkey(), half, 0, 0);
    env.send(&[ix], &lp).unwrap();

    // total shares = supply + locked = 2e9
    assert_eq!(env.user_bal(&lp, &env.mint_a), 1_999_999_000);
    assert_eq!(env.user_bal(&lp, &env.mint_b), 499_999_750);
    assert_eq!(env.bal(&env.vault_a), 4_000_000_000 - 1_999_999_000);
    assert_eq!(env.user_bal(&lp, &env.lp_mint), 999_999_500);
    assert_eq!(env.lp_supply(), 2_000_000_000 - MINIMUM_LIQUIDITY - half);
}

#[test]
fn remove_liquidity_enforces_minimums() {
    let (mut env, lp) = Env::with_liquidity(1_000_000_000, 1_000_000_000);
    let all = env.user_bal(&lp, &env.lp_mint);
    let ix = env.ix_remove(&lp.pubkey(), all, u64::MAX, 0);
    assert_program_error(env.send(&[ix], &lp), ErrorCode::SlippageExceeded);
    assert_eq!(env.user_bal(&lp, &env.lp_mint), all); // nothing burned
}

#[test]
fn full_withdrawal_leaves_the_locked_minimum_in_the_pool() {
    let (mut env, lp) = Env::with_liquidity(4_000_000_000, 1_000_000_000);
    let all = env.user_bal(&lp, &env.lp_mint);
    let ix = env.ix_remove(&lp.pubkey(), all, 0, 0);
    env.send(&[ix], &lp).unwrap();

    assert_eq!(env.lp_supply(), 0);
    assert!(env.bal(&env.vault_a) > 0 && env.bal(&env.vault_b) > 0);
    // and the LP got back slightly less than they put in, never more
    assert!(env.user_bal(&lp, &env.mint_a) < 4_000_000_000);
    assert!(env.user_bal(&lp, &env.mint_b) < 1_000_000_000);
}

// ---------------------------------------------------------------- swaps

#[test]
fn swap_a_to_b_pays_out_the_constant_product_amount() {
    let (mut env, _) = Env::with_liquidity(1_000_000_000, 1_000_000_000);
    let trader = env.new_user(10_000_000, 0);

    let ix = env.ix_swap(&trader.pubkey(), 10_000_000, 0, true);
    env.send(&[ix], &trader).unwrap();

    // 1e7 * 9970 * 1e9 / (1e9 * 1e4 + 1e7 * 9970) = 9_871_580 (0.3% fee)
    assert_eq!(env.user_bal(&trader, &env.mint_a), 0);
    assert_eq!(env.user_bal(&trader, &env.mint_b), 9_871_580);
    assert_eq!(env.bal(&env.vault_a), 1_010_000_000);
    assert_eq!(env.bal(&env.vault_b), 1_000_000_000 - 9_871_580);
    // the fee stays in the pool, so k grows
    let k = env.bal(&env.vault_a) as u128 * env.bal(&env.vault_b) as u128;
    assert!(k > 1_000_000_000u128 * 1_000_000_000u128);
}

#[test]
fn swap_b_to_a_works_in_the_other_direction() {
    let (mut env, _) = Env::with_liquidity(2_000_000_000, 1_000_000_000);
    let trader = env.new_user(0, 5_000_000);
    let expected = math::swap_output(1_000_000_000, 2_000_000_000, 5_000_000, FEE_BPS).unwrap();

    let ix = env.ix_swap(&trader.pubkey(), 5_000_000, expected, false);
    env.send(&[ix], &trader).unwrap();

    assert_eq!(env.user_bal(&trader, &env.mint_b), 0);
    assert_eq!(env.user_bal(&trader, &env.mint_a), expected);
    assert!(expected > 9_900_000 && expected < 10_000_000); // ~2 A per B minus fee and impact
}

#[test]
fn swap_fails_on_slippage_and_changes_nothing() {
    let (mut env, _) = Env::with_liquidity(1_000_000_000, 1_000_000_000);
    let trader = env.new_user(10_000_000, 0);

    let ix = env.ix_swap(&trader.pubkey(), 10_000_000, 9_871_581, true); // one unit too greedy
    assert_program_error(env.send(&[ix], &trader), ErrorCode::SlippageExceeded);

    assert_eq!(env.user_bal(&trader, &env.mint_a), 10_000_000);
    assert_eq!(env.bal(&env.vault_a), 1_000_000_000);
    assert_eq!(env.bal(&env.vault_b), 1_000_000_000);
}

#[test]
fn a_price_move_between_quote_and_execution_trips_the_slippage_guard() {
    let (mut env, _) = Env::with_liquidity(1_000_000_000, 1_000_000_000);
    let victim = env.new_user(10_000_000, 0);
    let whale = env.new_user(200_000_000, 0);
    // the victim quoted 9_871_580 out and set that as their minimum...
    let victim_ix = env.ix_swap(&victim.pubkey(), 10_000_000, 9_871_580, true);
    // ...but a big trade lands first and moves the price
    let whale_ix = env.ix_swap(&whale.pubkey(), 200_000_000, 0, true);
    env.send(&[whale_ix], &whale).unwrap();
    assert_program_error(env.send(&[victim_ix], &victim), ErrorCode::SlippageExceeded);
    assert_eq!(env.user_bal(&victim, &env.mint_a), 10_000_000); // funds untouched
}

#[test]
fn swap_with_zero_amount_fails() {
    let (mut env, _) = Env::with_liquidity(1_000_000_000, 1_000_000_000);
    let trader = env.new_user(1_000, 0);
    let ix = env.ix_swap(&trader.pubkey(), 0, 0, true);
    assert_program_error(env.send(&[ix], &trader), ErrorCode::ZeroAmount);
}

#[test]
fn swap_against_an_empty_pool_fails() {
    let mut env = Env::new();
    env.init_pool(FEE_BPS).unwrap();
    let trader = env.new_user(1_000_000, 0);
    let ix = env.ix_swap(&trader.pubkey(), 1_000_000, 0, true);
    assert_program_error(env.send(&[ix], &trader), ErrorCode::InsufficientLiquidity);
}

#[test]
fn a_round_trip_swap_costs_the_trader_fees() {
    let (mut env, _) = Env::with_liquidity(1_000_000_000, 1_000_000_000);
    let trader = env.new_user(50_000_000, 0);

    let ix = env.ix_swap(&trader.pubkey(), 50_000_000, 0, true);
    env.send(&[ix], &trader).unwrap();
    let got_b = env.user_bal(&trader, &env.mint_b);
    let ix = env.ix_swap(&trader.pubkey(), got_b, 0, false);
    env.send(&[ix], &trader).unwrap();

    assert!(env.user_bal(&trader, &env.mint_a) < 50_000_000);
}

// ---------------------------------------------------------------- security

#[test]
fn swap_rejects_a_fake_vault() {
    let (mut env, _) = Env::with_liquidity(1_000_000_000, 1_000_000_000);
    let trader = env.new_user(10_000_000, 10_000_000);

    // point vault_a at the trader's own token account
    let mut ix = env.ix_swap(&trader.pubkey(), 1_000_000, 0, true);
    let own = env.ata(&trader.pubkey(), &env.mint_a);
    ix.accounts[4].pubkey = own; // vault_a slot
    assert!(env.send(&[ix], &trader).is_err());
}

#[test]
fn cannot_swap_using_someone_elses_token_account() {
    let (mut env, _) = Env::with_liquidity(1_000_000_000, 1_000_000_000);
    let attacker = env.new_user(0, 0);
    let victim = env.new_user(10_000_000, 0);

    // attacker signs but names the victim's token account as the source
    let mut ix = env.ix_swap(&attacker.pubkey(), 10_000_000, 0, true);
    ix.accounts[6].pubkey = env.ata(&victim.pubkey(), &env.mint_a); // user_a slot
    assert!(env.send(&[ix], &attacker).is_err());
    assert_eq!(env.user_bal(&victim, &env.mint_a), 10_000_000);
}

#[test]
fn cannot_remove_liquidity_with_someone_elses_lp_tokens() {
    let (mut env, lp) = Env::with_liquidity(1_000_000_000, 1_000_000_000);
    let attacker = env.new_user(0, 0);
    env.create_lp_account(&attacker);

    let mut ix = env.ix_remove(&attacker.pubkey(), 1_000_000, 0, 0);
    ix.accounts[9].pubkey = env.ata(&lp.pubkey(), &env.lp_mint); // user_lp slot
    assert!(env.send(&[ix], &attacker).is_err());
    assert_eq!(env.lp_supply(), 1_000_000_000 - MINIMUM_LIQUIDITY);
}
