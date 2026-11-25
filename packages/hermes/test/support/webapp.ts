import { fakeWebapp, type FakeWebapp, type WebappScenarioName } from '../../src/testing/fake-webapp'
import { systemClock, type Clock } from '../../src/wire/link'
import type { Loopback } from '../../src/testing/loopback'
import { closing, errandGateway, listen } from './host'

/** A fake Webapp in front of `gateway`, or of a new errand gateway, closed after the test. */
export const webapp = async (
  name: WebappScenarioName,
  options: { readonly gateway?: Loopback; readonly clock?: Clock; readonly prefix?: string } = {}
): Promise<FakeWebapp> => {
  const { gateway = await listen(errandGateway()), clock = systemClock, ...rest } = options
  return closing(await fakeWebapp(name, gateway, clock, rest), held => held.close())
}
