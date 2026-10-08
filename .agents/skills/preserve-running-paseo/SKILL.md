---
name: preserve-running-paseo
description: Preserves the user's running Paseo and Paseo Neo app and daemon during builds, packaging, installation, and troubleshooting. Use before any installed-app or lifecycle change.
---

# Preserve running Paseo

Require an explicit user request before quitting, restarting, relaunching, or
reloading the user's Paseo or Paseo Neo window, app, daemon, or supervisor. Apply
this rule to every port and profile, including Neo. A window restart disrupts the
user even when the daemon and agents keep running.

## Keep authorization specific

- Building, rebuilding, packaging, committing, pushing, and copying a DMG to
  Downloads authorize those actions. Finish a build by delivering the installer.
- Installing, reinstalling, replacing, or restoring an installed app requires an
  explicit request for that installed app. Resolve any uncertainty about the
  destination or scope before changing it. An install request does not authorize
  quitting or relaunching a running app or restarting its daemon.
- An app/window restart and a daemon/supervisor restart are separate actions.
  Approval for one does not authorize the other. Honor an existing explicit
  request without asking again for the same action and target.
- If wording such as "reinstall to Downloads" leaves the destination or restart
  scope unclear, complete the build and copy first. Clarify the unresolved action
  before changing the installed app or its running processes.
- A pending question, a preselected answer, silence, elapsed time, or
  `keepRunningAfterQuit=true` supplies no authorization for these changes.

## Before an authorized change

Identify the exact app, process, profile/home, and endpoint. If the requested
action would also stop or restart another component, preserve that component or
explain the actual impact and obtain authorization for it first. Use exact
process targets; broad `pkill` commands can also kill daemons and agents.

Build and verify artifacts before requesting any missing lifecycle authorization.
Do not open an installer, launch the installed app for verification, replace its
bundle, change quit preferences, or restart a service to address a timeout without
the corresponding explicit request.

If an unauthorized change already happened, stop further app and process changes
and report what happened and the current state. Prepare any rollback for review;
do not trigger another quit, restart, or replacement automatically to undo it.

You may create and dispose isolated test instances within an authorized testing
task. Verify separate daemon home and desktop user-data directories,
non-conflicting ports, and task-owned processes before treating an instance as
isolated from the user's running app and daemon.
