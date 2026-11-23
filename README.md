# Highwing

Highwing is a desktop client for the Hermes agent gateway.

## Install on Arch

Highwing builds as an Arch package from this repository. The package bundles Electron 45.4.1, because Arch's `extra` repository has `electron39` to `electron44` and no `electron45`. The installed package takes about 275 MB.

The build needs a network connection. It downloads the Electron release zip and checks its sha256 sum. It also downloads the npm packages that the repository's `pnpm-lock.yaml` pins.

1. Install the tools that `makepkg` needs. It installs the other build dependencies itself.

   ```sh
   sudo pacman -S --needed base-devel git
   ```

2. Clone the repository.

   ```sh
   git clone https://github.com/l0cky12/hingwing-2.0.git
   cd hingwing-2.0
   ```

3. Make the source tarball from the checkout. `git archive` packs the last commit, so commit or stash your changes first.

   ```sh
   git archive --prefix=highwing/ -o packaging/arch/highwing.tar.gz HEAD
   ```

4. Build and install the package. Run `makepkg` as your normal user, not as root.

   ```sh
   cd packaging/arch
   makepkg -si
   ```

5. Start Highwing. Open **Highwing** from your application menu, or run `highwing` in a shell.

The first time Highwing starts, it asks where Hermes runs. To use the Hermes on this computer, choose **This computer** and then **Connect**. To use a Hermes on another machine, see [Connect over Tailscale](#connect-over-tailscale).

### Update or remove

To update, pull the new commits, repeat steps 3 and 4, and add `-f` to `makepkg` so that it rebuilds the existing package.

To remove Highwing, run `sudo pacman -Rns highwing`. Your saved connection and Electron's cache stay in `~/.config/Highwing`. Delete that directory to remove them.

## Connect over Tailscale

Highwing can use a Hermes gateway on another machine of your tailnet. Highwing reaches that machine over SSH. On that machine, it runs `hermes gateway attach` for a new single-use ticket each time it connects, and it carries the connection through an SSH tunnel to the gateway. The gateway keeps listening only on that machine's loopback address, so you do not open any port.

The steps below call the two machines the Hermes machine and this computer. The examples use `hermes-host` as the Hermes machine's Tailscale name. Use your machine's name in its place.

### On the Hermes machine

1. Install Hermes for the user that Highwing logs in as. Highwing looks for `hermes` on the `PATH` of a Bash login shell (`bash -lc`) for that user, then in `~/.local/bin`, `/usr/local/bin` and `~/.hermes/hermes-agent/venv/bin`.
2. Install Tailscale and sign in to your tailnet.
3. Let this computer log in over SSH. Do one of these:
   - Turn on Tailscale SSH with `sudo tailscale set --ssh`, and allow this computer in your tailnet's SSH rules.
   - Run OpenSSH's `sshd`, and add this computer's public key to `~/.ssh/authorized_keys`.

You do not need to start the Hermes gateway. Highwing starts it when it first connects. The one exception is a Windows machine where your SSH login runs as an administrator service session. There, start Hermes yourself from a normal window on that machine's desktop.

### On this computer

1. Install Tailscale and sign in to the same tailnet.

   ```sh
   sudo pacman -S tailscale
   sudo systemctl enable --now tailscaled
   sudo tailscale up
   ```

2. Log in to the Hermes machine once from a terminal, as the user Highwing will log in as. Highwing never types a password or a passphrase, and this first login records the machine's host key. If your key has a passphrase, add it to `ssh-agent` first. If Tailscale SSH asks you to approve the login in a browser, approve it.

   ```sh
   ssh hermes-host true
   ```

   To log in as a different user on the Hermes machine, use `user@hermes-host` here and in step 4.

3. Start Highwing. On the setup screen, choose **Another machine on my tailnet**.
4. In **Hermes machine**, type the machine's Tailscale name, for example `hermes-host` or `hermes-host.example-tailnet.ts.net`. To log in as a different user, type `user@hermes-host`.
5. Choose **Connect**. Highwing checks Tailscale on this computer, finds the machine on your tailnet, logs in over SSH and finds Hermes there. The screen shows each step.
6. When the check passes, choose **Open chat**.

Highwing saves the connection in `~/.config/Highwing/connection.json` and opens on the chat from then on. The file holds only the SSH destination you typed, including a `user@` part if you typed one. Ports, keys and any other SSH options come from your SSH configuration. To change the machine, choose **Connection** in the top bar. **Cancel** goes back to the chat and keeps your draft.

### If the check fails

The setup screen says what failed and one thing to try. The most common failures:

| The screen says | Try this |
|---|---|
| Tailscale isn't running on this computer. | Run `sudo systemctl start tailscaled`, then `sudo tailscale up`. |
| No machine called hermes-host is on your tailnet. | Run `tailscale status` and use a name from its list. |
| Your tailnet lists hermes-host, but it is offline. | Turn that machine on, or start Tailscale on it. |
| Highwing can't reach hermes-host over SSH. | Check that Tailscale SSH or `sshd` is on there. |
| The machine hermes-host refused this computer's SSH login. | Add your key to `ssh-agent` or to that machine's `~/.ssh/authorized_keys`, or allow this computer in your tailnet's SSH rules. |
| Tailscale wants you to confirm this connection in a browser. | Run `ssh hermes-host true` in a terminal, with the same `user@` part you typed in Highwing, and approve the login. Then choose **Connect** again. |
| Hermes isn't installed on hermes-host. | Install Hermes for the user Highwing logs in as. |
| The Hermes on hermes-host is too old for Highwing. | Run `hermes update` on that machine. |
