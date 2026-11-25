---
name: Bug
about: Highwing does the wrong thing, or a check fails when it shouldn't
title: ""
labels: bug
assignees: ""
---

<!--
Title: the wrong behavior, in plain words. Say what happens, not the fix.
  good: Open and Preview act on this computer for a remote Hermes's file paths
  good: The markdown-keys verify recipe fails some runs at the same commit
  bad:  Fix the file handler
  bad:  FilePath bug

Agents: fill in every section. Write "None" or "Not verified" instead of
deleting a section. Keep "What happens" short and about the symptom. Long
debugging goes in the <details> block under "Cause".
-->

## What happens

<!-- What a person sees, or which check fails. Where and how often:
     platform, local or remote Hermes, every time or N of M runs. -->

## What should happen

## How to reproduce

<!-- Numbered steps from a fresh start, or the exact command. If it was found
     by reading code or by review, not by running it, say who found it, where,
     and that it hasn't been reproduced. -->
1.

**Seen on.** commit `` · Hermes `` · OS

## Cause

<!-- Start with one word. Confirmed: you traced it, with file:line references.
     Suspected: your best guess. Unknown: you haven't looked.
     If it's a regression, name the commit or PR that broke it. -->
**Confirmed / Suspected / Unknown.**

<details><summary>Investigation</summary>

</details>

## Fix direction

Ideas, not a spec.

-

## Done check

<!-- The first check is a test that fails on main today and passes with the fix. -->
1.

**Say in the PR.**

## Size and dependencies

**Size.** S / M / L

**Depends on.** Nothing.

**Related.**
