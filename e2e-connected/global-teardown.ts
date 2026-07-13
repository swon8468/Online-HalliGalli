import { assertConnectedFixturesRemoved, removeConnectedFixtures } from './fixture'

export default async function globalTeardown() {
  await removeConnectedFixtures()
  await assertConnectedFixturesRemoved()
}
