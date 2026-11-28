import { byKind, gatewayHost, isPlainHttp, parseGatewayUrl, parseSshHost, URL_PROBLEMS, type Target } from '@highwing/hermes/domain'

export type Kind = Exclude<Target['kind'], 'remote'>

export const LEAD = 'Highwing talks to the Hermes gateway on another machine over SSH, at a web address, or on this computer.'

export const SIGN_IN_HINT = 'Highwing opened the sign-in page in your browser. It never sees your password.'

const NOT_A_DESTINATION = "That isn't an SSH destination. Use an address such as 192.168.1.20, or a host in your SSH config."

function plainHttpWarning(text: string): string | null {
  const parsed = parseGatewayUrl(text)
  if (!parsed.ok || !isPlainHttp(parsed.url)) return null
  return `This address uses plain http, so your Hermes sign-in and your chats travel unencrypted. Anyone on the network between here and ${gatewayHost(parsed.url)} could read them. Use https if you can.`
}

export type Typed =
  | { readonly ok: true; readonly target: Target }
  | { readonly ok: false; readonly words: string; readonly fix: string | null }

interface Field {
  readonly label: string
  readonly placeholder: string
  readonly hint: string
  readonly warning: (text: string) => string | null
}

interface Choice {
  readonly label: string
  readonly field: Field | null
  readonly read: (text: string) => Typed
}

export const CHOICES: { readonly [K in Kind]: Choice } = {
  ssh: {
    label: 'SSH',
    field: { label: 'SSH destination', placeholder: '192.168.1.20', hint: 'A Tailscale name, a LAN address, or a host in your SSH config. Add user@ in front to log in as someone else.', warning: () => null },
    read: text => {
      const host = parseSshHost(text)
      return host === null ? { ok: false, words: NOT_A_DESTINATION, fix: null } : { ok: true, target: { kind: 'ssh', host } }
    }
  },
  url: {
    label: 'Web',
    field: {
      label: 'Gateway address', placeholder: 'https://hermes.example.com',
      hint: "The address of the gateway's Webapp, not the dashboard's. Highwing uses https unless the address starts with http://.",
      warning: plainHttpWarning
    },
    read: text => {
      const parsed = parseGatewayUrl(text)
      return parsed.ok ? { ok: true, target: { kind: 'url', url: parsed.url } } : { ok: false, ...URL_PROBLEMS[parsed.problem] }
    }
  },
  local: { label: 'This computer', field: null, read: () => ({ ok: true, target: { kind: 'local' } }) }
}

export const KINDS = Object.keys(CHOICES) as readonly Kind[]

// SSH reaches a tailnet name through MagicDNS, so a saved tailnet machine is edited as SSH.
export const kindOf = (target: Target): Kind => byKind<Kind>(target, { local: () => 'local', remote: () => 'ssh', ssh: () => 'ssh', url: () => 'url' })

export function textsOf(shown: Target | undefined): Readonly<Record<Kind, string>> {
  const typed = shown === undefined ? {} : byKind<Partial<Record<Kind, string>>>(shown, {
    local: () => ({}),
    remote: ({ host }) => ({ ssh: host }),
    ssh: ({ host }) => ({ ssh: host }),
    url: ({ url }) => ({ url })
  })
  return { local: '', ssh: '', url: '', ...typed }
}
