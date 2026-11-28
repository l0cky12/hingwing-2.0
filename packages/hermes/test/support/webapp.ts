import { fakeWebapp, type FakeWebapp, type WebappScenarioName } from '../../src/testing/fake-webapp'
import { systemClock, type Clock } from '../../src/wire/link'
import type { Drive } from '../../src/testing/files'
import type { Loopback } from '../../src/testing/loopback'
import { closing, errandGateway, listen } from './host'

export const webapp = async (
  name: WebappScenarioName,
  options: { readonly gateway?: Loopback; readonly clock?: Clock; readonly prefix?: string; readonly drive?: Drive } = {}
): Promise<FakeWebapp> => {
  const { gateway = await listen(errandGateway()), clock = systemClock, ...rest } = options
  return closing(await fakeWebapp(name, gateway, clock, rest), held => held.close())
}
