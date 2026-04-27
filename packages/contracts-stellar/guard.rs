use soroban_sdk::{Env, Symbol};

const LOCK_KEY: &str = "reentrancy_lock";

pub struct ReentrancyGuard<'a> {
    env: &'a Env,
}

impl<'a> ReentrancyGuard<'a> {
    pub fn new(env: &'a Env) -> Self {
        let key = Symbol::new(env, LOCK_KEY);

        let locked: bool = env.storage().instance().get(&key).unwrap_or(false);

        if locked {
            panic!("ReentrancyGuard: reentrant call detected");
        }

        env.storage().instance().set(&key, &true);

        Self { env }
    }
}

impl Drop for ReentrancyGuard<'_> {
    fn drop(&mut self) {
        let key = Symbol::new(self.env, LOCK_KEY);
        self.env.storage().instance().set(&key, &false);
    }
}