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

Highwing runs the `hermes` command on the same computer. If the command is missing, the window shows "Highwing can't find the hermes command." Install Hermes, then choose **Retry**.

### Update or remove

To update, pull the new commits, repeat steps 3 and 4, and add `-f` to `makepkg` so that it rebuilds the existing package.

To remove Highwing, run `sudo pacman -Rns highwing`. Electron's cache stays in `~/.config/Highwing`. Delete that directory to remove it.
