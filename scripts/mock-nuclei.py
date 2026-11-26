#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""mock-nuclei: deterministic Nuclei CLI mock for testing callers.

Emits nuclei-compatible JSONL ResultEvents from a findings file so that
wrapper code (vf_template_run, pipelines) can be tested without the real
binary, network access, or the template engine.

Controls:
  MOCK_NUCLEI_FINDINGS  path to a JSON findings file
  MOCK_NUCLEI_DELAY     simulated scan delay in seconds (default 0.05)
  MOCK_NUCLEI_EXIT      process exit code (default 0)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

DEFAULT_FINDINGS: list[dict] = [
    {
        "template-id": "tech-detect",
        "info": {"name": "Tech Detect", "severity": "info", "tags": "tech"},
        "matched-at": "http://127.0.0.1/",
        "host": "127.0.0.1",
        "type": "http",
        "url": "http://127.0.0.1/",
    }
]


def load_findings() -> list[dict]:
    path = os.environ.get("MOCK_NUCLEI_FINDINGS")
    if path and Path(path).exists():
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    return DEFAULT_FINDINGS


def main() -> None:
    parser = argparse.ArgumentParser(prog="nuclei", add_help=False)
    parser.add_argument("-u", "--target", action="append", default=[])
    parser.add_argument("-l", "--list")
    parser.add_argument("-t", "--templates", action="append", default=[])
    parser.add_argument("-jsonl", "-j", action="store_true")
    parser.add_argument("-o", "--output")
    parser.add_argument("-silent", action="store_true")
    parser.add_argument("-severity")
    parser.add_argument("-tags")
    parser.add_argument("-version", action="store_true")
    parser.add_argument("-h", "--help", action="store_true")
    args, _ = parser.parse_known_args()

    if args.version:
        print("Nuclei Engine Version: v3.11.1 (mock)")
        sys.exit(0)
    if args.help:
        print("Mock Nuclei CLI - for testing only")
        sys.exit(0)

    findings = load_findings()
    if args.severity:
        wanted = {item.strip() for item in args.severity.split(",")}
        findings = [f for f in findings if f.get("info", {}).get("severity") in wanted]
    if args.tags:
        wanted = {item.strip() for item in args.tags.split(",")}
        findings = [
            f
            for f in findings
            if wanted.intersection(
                str(f.get("info", {}).get("tags", "")).split(",")
            )
        ]

    time.sleep(float(os.environ.get("MOCK_NUCLEI_DELAY", "0.05")))

    lines: list[str] = []
    for finding in findings:
        if args.jsonl:
            lines.append(json.dumps(finding, ensure_ascii=False))
        else:
            severity = finding.get("info", {}).get("severity", "info")
            template_id = finding.get("template-id", "unknown")
            matched = finding.get("matched-at", "")
            lines.append(f"[{template_id}] [http] [{severity}] {matched}")

    text = "\n".join(lines) + ("\n" if lines else "")
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)

    sys.exit(int(os.environ.get("MOCK_NUCLEI_EXIT", "0")))


if __name__ == "__main__":
    main()
