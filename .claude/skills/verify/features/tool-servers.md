# Tool servers

The Connect apps window ends with a Tool servers section, below the apps and outside their search and chips. It belongs to the bot the window lists apps for: the open chat's bot, or the bot Hermes runs as. Each server the bot holds is a row with its name, its address without a query or its command and arguments, and its state in words: "Connected · N tools", "Connecting", "Couldn't connect", "Needs sign-in", "Off" or "Starts when a chat needs it". A server a plugin provides says "From a plugin" in place of Remove. "Remove tool server <name>" takes a server out and the list is read again.

"Add a tool server" opens a form under the list. Name, then Type as Web address or Command. Web address asks for an Address and any number of Headers, each a name and a hidden value. Command asks for the Command to run, which runs on the Hermes machine, and its Arguments, one per line. Test and add reads "Testing…" while main adds the server, tests it, and takes it out again if the test fails. A pass says "Connected. <name> has N tools: …" in a status line, joins the list, and closes and empties the form, header values with it. A failure says "Couldn't connect to <name>: <reason>. Nothing was saved." in an alert, and a server that asks for a sign-in says "<name> needs a sign-in, which Highwing can't do yet. Nothing was saved." The form keeps what was typed after a failure. A name already taken is refused before any test. Hermes never sends a header value back, so no screen shows one after the add.

A Hermes without `mcp.servers.*`, or a connection bound to one profile, shows "This Hermes can't manage tool servers from Highwing." in the section, with no Add button.

## Sub-features

- `tools-list` lists the home bot's connected server and a plugin's server, with no Remove for the plugin's, then opens Research, which has none.
- `tools-add` adds a web address that fails, one that asks for a sign-in, one with a header that passes, and a command that passes.
- `tools-remove` removes a server and leaves the plugin's.

## How to get to it (user POV)

- Click Connect apps at the bottom of the sidebar, or press Ctrl+Shift+M, and scroll to Tool servers.

## Driving it with highwing-verify

Preconditions:

- `--mcp fixtures/mcp/servers.json` gives the home bot (`default`, Emu) a connected `github` server and a plugin's `browser` server. Its probes pass for `linear` and `files`, fail for `broken`, and ask for a sign-in for `notion`.
- `--profiles fixtures/profiles/roster.json` lists the bots. Without `--connectors` the apps list says "This Hermes can't list its apps." and Tool servers still shows.

- **The list.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --mcp fixtures/mcp/servers.json --run tools-list wait live wait bots click button "Connect apps" wait apps reveal region "Tool servers" see "Connected · 41 tools" see "From a plugin" count button "Remove tool server github" 1 count button "Remove tool server browser" 0 shot tools-list press Escape gone dialog "Connect apps" click button Research wait live click button "Connect apps" wait apps reveal region "Tool servers" see "No tool servers yet." shot tools-research`.
- **Add.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --mcp fixtures/mcp/servers.json --run tools-add wait live wait bots click button "Connect apps" wait apps click button "Add a tool server" type Name broken type Address https://broken.example.com/mcp click button "Test and add" see "Couldn't connect to broken: Connection refused. Nothing was saved." count button "Remove tool server broken" 0 shot add-failed type Name notion type Address https://mcp.notion.example/mcp click button "Test and add" see "notion needs a sign-in, which Highwing can't do yet. Nothing was saved." count button "Remove tool server notion" 0 type Name linear type Address https://mcp.linear.example/mcp click button "Add header" type "Header 1 name" Authorization type "Header 1 value" lin-secret-123 click button "Test and add" see "Connected. linear has 7 tools: list_issues, get_issue, create_issue, update_issue, list_projects and 2 more." called mcp.servers.add '{"name":"linear","config":{"headers":{"Authorization":"•••"}}}' 1 count button "Remove tool server linear" 1 count textbox "Header 1 value" 0 shot add-passed click button "Add a tool server" type Name files click button Command type "Command to run" npx type Arguments $'-y\n@modelcontextprotocol/server-filesystem\n/srv' click button "Test and add" see "Connected. files has 2 tools: read_file, list_directory." see "npx -y @modelcontextprotocol/server-filesystem /srv" shot add-command`. The header value goes in a password field, so the run's leak check fails the run if it is in any evidence file, and `gateway-calls.jsonl` records it masked.
- **Remove.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --mcp fixtures/mcp/servers.json --run tools-remove wait live wait bots click button "Connect apps" wait apps click button "Remove tool server github" gone button "Remove tool server github" count button "Remove tool server browser" 0 see "From a plugin" shot removed`.
