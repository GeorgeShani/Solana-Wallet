import { describe, expect, test } from 'bun:test'
import { claimUrl, generateLinkSecret, parseLinkSecret } from './secret'

describe('link secrets', () => {
  test('a generated secret round-trips through the URL fragment to the same claim key', async () => {
    const made = await generateLinkSecret()
    const url = claimUrl(made.secret, 'https://wallet.example')
    expect(url).toBe(`https://wallet.example/claim#${made.secret}`)

    const parsed = await parseLinkSecret(new URL(url).hash)
    expect(parsed?.claimKey).toBe(made.claimKey)
    expect(parsed?.secret).toBe(made.secret)
  })

  test('every link gets a different secret and claim key', async () => {
    const [a, b] = await Promise.all([generateLinkSecret(), generateLinkSecret()])
    expect(a.secret).not.toBe(b.secret)
    expect(a.claimKey).not.toBe(b.claimKey)
  })

  test('the claim key is a valid public key and the secret is 32 bytes of base58', async () => {
    const { secret, claimKey } = await generateLinkSecret()
    expect(claimKey.length).toBeGreaterThanOrEqual(32)
    expect(secret.length).toBeGreaterThanOrEqual(32)
    expect(secret.length).toBeLessThanOrEqual(44)
  })

  test('rejects malformed secrets', async () => {
    for (const bad of ['', '#', 'not-base58!!!', '0OIl', 'abc', '1'.repeat(10), 'z'.repeat(60)]) {
      expect(await parseLinkSecret(bad)).toBeNull()
    }
  })

  test('tolerates the leading # and surrounding whitespace', async () => {
    const { secret, claimKey } = await generateLinkSecret()
    expect((await parseLinkSecret(`#${secret}`))?.claimKey).toBe(claimKey)
    expect((await parseLinkSecret(`  ${secret}\n`))?.claimKey).toBe(claimKey)
  })
})
