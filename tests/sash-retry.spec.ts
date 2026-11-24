import { describe, expect, it } from 'vitest'

import { QoderUpstreamClient } from '../src/upstream.ts'

/**
 * 积分 / 活动两条 sash 面也要有「会话过期自愈」。
 *
 * chat 面在 2026-11-23 加了自愈（105 / TOKEN_EXPIRE → 重换 jobToken 重试一次），
 * 但 sash 面（`/sash/api/v2/me/usage`、`/sash/.../campaigns`）当时没跟上：上游把
 * 会话提前回收时，积分卡片与活动区会一直报「API 密钥无效」，直到用户重启 DSH。
 *
 * 这里钉住三条契约：
 *   ① 积分查询撞 TOKEN_EXPIRE → 重换一次 jobToken → 重试一次即成功；
 *   ② 活动查询同理；
 *   ③ 真坏凭据（TOKEN_INVALID）不重试、不重复换票，错误原样抛出。
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

/** 上游的两种交换端点都含 "jobToken"，必须按路径分开数，否则一次会话建立算两次。 */
function stubUpstream(plan: {
  /** 第 n 次 sash 用量请求返回什么；用完后一律成功。 */
  usage?: Array<() => Response>
  /** 第 n 次活动请求返回什么；用完后一律成功。 */
  campaigns?: Array<() => Response>
}) {
  const calls = { jobToken: 0, sashExchange: 0, usageSash: 0, usagePat: 0, campaigns: 0 }
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const auth = new Headers(init?.headers ?? {}).get('authorization') ?? ''
    if (u.includes('/api/v1/jobToken/exchange')) {
      calls.sashExchange += 1
      return json({ token: 'jt-SASH', expires_at: new Date(Date.now() + 86_400_000).toISOString() })
    }
    if (u.includes('jobToken')) {
      calls.jobToken += 1
      return json({
        id: 'u1', name: 'n', expireTime: Date.now() + 1e6,
        securityOauthToken: 'jt-CHAT', refreshToken: 'r', userType: 'personal_standard',
      })
    }
    if (u.includes('/sash/api/v2/me/usage')) {
      if (auth.startsWith('Bearer jt-')) {
        const step = plan.usage?.[calls.usageSash]
        calls.usageSash += 1
        return step ? step() : json({ qoderUsage: { addOnQuota: { total: 100, used: 8, remaining: 92 } } })
      }
      calls.usagePat += 1
      return json({ message: 'token is not active' }, 401)
    }
    if (u.includes('/campaigns')) {
      const step = plan.campaigns?.[calls.campaigns]
      calls.campaigns += 1
      return step ? step() : json({ campaigns: [{ campaignId: 'c1', actionType: 'VIEW_DETAILS', claimStatus: 'CLAIMED' }] })
    }
    return json({}, 404)
  }) as unknown as typeof fetch
  return { calls, client: new QoderUpstreamClient('cn', { fetch: fetchImpl }) }
}

const tokenExpire = () => json({ code: 'TOKEN_EXPIRE', message: 'token is not active' }, 401)
const tokenInvalid = () => json({ code: 'TOKEN_INVALID', message: 'invalid token' }, 401)

describe('sash 面的会话过期自愈', () => {
  it('积分查询撞 TOKEN_EXPIRE：重换一次 jobToken，重试一次就成功', async () => {
    const { calls, client } = stubUpstream({ usage: [tokenExpire] })

    const usage = await client.fetchUsage('pt-x')

    expect(usage?.addOnQuota?.remaining).toBe(92)
    expect(calls.usageSash, '第一次失败 + 自愈后第二次成功').toBe(2)
    expect(calls.jobToken, '初次交换 + 命中后重换').toBe(2)
  })

  it('活动查询撞 TOKEN_EXPIRE：同样自愈', async () => {
    const { calls, client } = stubUpstream({ campaigns: [tokenExpire] })

    const feed = await client.fetchCampaignFeed('pt-x')

    expect(feed.campaigns).toHaveLength(1)
    expect(feed.campaigns[0]?.campaignId).toBe('c1')
    expect(calls.campaigns).toBe(2)
    expect(calls.jobToken).toBe(2)
  })

  it('积分查询撞 TOKEN_INVALID（真坏凭据）：不重试、不重换，原样抛出', async () => {
    const { calls, client } = stubUpstream({ usage: [tokenInvalid] })

    await expect(client.fetchUsage('pt-x')).rejects.toMatchObject({
      kind: 'auth',
      code: 'TOKEN_INVALID',
      status: 401,
    })
    expect(calls.usageSash).toBe(1)
    expect(calls.jobToken).toBe(1)
  })

  it('活动查询撞 TOKEN_INVALID：不重试', async () => {
    const { calls, client } = stubUpstream({ campaigns: [tokenInvalid] })

    await expect(client.fetchCampaignFeed('pt-x')).rejects.toMatchObject({ code: 'TOKEN_INVALID' })
    expect(calls.campaigns).toBe(1)
    expect(calls.jobToken).toBe(1)
  })
})
