/**
 * Tavily 搜尋 API wrapper — 讓 AI 能即時查網路。
 * 申請:https://tavily.com (免費版 1000 次/月)
 * key 放 .env.local 的 VITE_TAVILY_API_KEY
 */
const TAVILY_KEY = import.meta.env.VITE_TAVILY_API_KEY
export const tavilyReady = Boolean(TAVILY_KEY)

/**
 * 搜尋網路。
 * @param {string} query - 查詢字串
 * @param {Object} opts  - {maxResults, searchDepth: 'basic'|'advanced', includeAnswer: boolean}
 * @returns {Promise<{answer, results: [{title, url, content, score}]}>}
 */
export async function webSearch(query, opts = {}) {
  if (!TAVILY_KEY) throw new Error('Tavily API Key 未設定')
  const body = {
    api_key: TAVILY_KEY,
    query,
    max_results: opts.maxResults ?? 5,
    search_depth: opts.searchDepth ?? 'basic',
    include_answer: opts.includeAnswer ?? true,
    include_raw_content: false
  }
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Tavily ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  return {
    answer: data.answer || '',
    results: (data.results || []).map(r => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score
    }))
  }
}

/** 把搜尋結果格式化成可讓 AI 讀的純文字 */
export function formatSearchResults(query, search) {
  const parts = [`[搜尋查詢] ${query}`]
  if (search.answer) parts.push(`[Tavily 摘要] ${search.answer}`)
  for (const r of search.results) {
    parts.push(`---\n[${r.title}] ${r.url}\n${r.content}`)
  }
  return parts.join('\n')
}
