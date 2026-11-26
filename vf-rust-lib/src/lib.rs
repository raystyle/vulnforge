//! vf_rust_lib: the materialized base library for VulnForge exploit rs
//! scripts. Web exploit first, others supplementary.
//!
//! Every exploit rs script prints exactly ONE AgentResult JSON line
//! (success or failure — both are data, never panics). Failures carry an
//! atomic error {kind, code, message} plus a next_suggestion
//! (attack-chain pointer). Errors and their default suggestions are fully
//! internalized here: script authors call constructors, no external
//! registry, no knowledge base, no docs lookup.
//!
//! The exploit flow itself is state-machine-ized (mandatory template):
//! declare steps at the top of the script (reading the script reads the
//! state diagram), transitions only via Advance / Fail / Done, the step
//! trace lands in the envelope's data.steps.

pub mod error;
pub mod machine;
pub mod report;
pub mod tls;
