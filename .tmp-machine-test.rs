#!/usr/bin/env rust-script
//! name: machine-selftest
//! description: vf_rust_lib Machine 模板自证（success/failure/data 同形）
//! version: 1.0.0
//! args:
//! keywords: selftest
//!
//! ```cargo
//! [dependencies]
//! vf_rust_lib = { path = "D:/repos/vulnforge/vf-rust-lib" }
//! serde_json = "1"
//! ```
use serde_json::json;
use vf_rust_lib::error::Atom;
use vf_rust_lib::machine::{Machine, Outcome, Step};
use vf_rust_lib::report;

fn main() {
    let mut m = Machine::standard();
    let (ok, value) = m.run(|step, state| match step {
        Step::Check => Outcome::Success(json!({"options": "complete"})),
        Step::Probe => Outcome::Success(json!({"fingerprint": state.get("options").cloned().unwrap_or_default()})),
        Step::Craft => Outcome::Success(json!({"payload": "crafted"})),
        Step::Deliver => Outcome::Success(json!({"delivered": true})),
        Step::Verify => Outcome::Data(json!({"exploited": true, "evidence": "marker found"})),
        Step::Custom(_) => Outcome::Failure(Atom::parse("E_X_001", "unexpected step"), String::new()),
    });
    if ok {
        report::success("machine-selftest", value, "template verified end-to-end");
    } else {
        let atom = Atom::soft_success("E_FLOW_002", "selftest failed");
        report::failure("machine-selftest", &atom, "");
    }
}
