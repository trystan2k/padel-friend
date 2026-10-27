# Question bank

Coverage checklist for grilling. Each topic ends as **answered** (a D-n row or a fact with a source), **N/A** (with a reason), or **asked**. Skip a question when grounding already answered it. Never ask the PO for a fact you can find in the code or docs.

## Problem and value

- Who exactly has the problem, and how do they work around it today?
- What happens if we do nothing?
- Which success metric will move, and how will we measure it?
- Is there a deadline or an event this depends on?

## Scope

- What is the smallest version that still solves the problem?
- Which nearby features are tempting but out of scope?
- Is this a new capability, a change to an existing one, or a replacement? What happens to existing behavior and data?

## Users, roles, and permissions

- Which roles can see, create, edit, delete? Check against the role model in `docs/specs/0001-authentication-and-roles.md`.
- What does a user without permission see: hidden, disabled, or an error?
- Does tenant (agency) isolation apply? Can Origin staff see it?

## Behavior and rules

- What are the exact business rules, limits, and defaults?
- What are the states and transitions of the main entity? Who triggers each one?
- What happens on duplicates, concurrent edits, and partial failures?
- What are the empty, zero, maximum, and invalid-input cases?

## Data

- Which entities and fields are new or changed? Who owns them?
- Is any of it PII or client data? Retention and deletion rules (LGPD)?
- Does existing data need a migration or backfill? Is it reversible?
- Which region stores and processes it (ADR-0003 regional cells)?

## UX

- Which Pen frames cover it? Are all states designed (empty, loading, error, success)?
- What copy is new? Is pt-BR final or does it need review?
- Mobile and desktop behavior?
- Notifications, emails, or other messages to users?

## Integrations

- Which external services, webhooks, or scheduled jobs are involved?
- What happens when an external service is slow or down?
- Are there rate limits, quotas, or costs?

## Non-functional

- Expected volume and latency targets?
- What must be audited or logged? Which alerts are needed?
- Accessibility needs beyond the WCAG 2.2 AA default?

## Rollout and acceptance

- Ship behind a feature flag or directly?
- Who runs UAT on staging, with which synthetic test data?
- What result on staging means "accept"?
- Is any part a human decision mid-build (HITL slice)?
