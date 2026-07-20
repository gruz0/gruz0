#!/usr/bin/env node
// Regenerates the "Recent articles" list in README.md from the blog's RSS feed.
//
// The feed is already sorted newest-first and excludes future-dated (scheduled)
// posts, so this just takes the first N items verbatim.
//
// No dependencies on purpose: it runs on whatever Node the Actions runner has,
// and a profile README isn't worth a lockfile to maintain.
//
// Usage: node scripts/update-articles.mjs [--check]
//   --check  exit 1 if the README is out of date, without writing (for CI)

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const FEED_URL = 'https://alexkadyrov.com/feed.xml'
const COUNT = 10
const UTM = 'utm_source=github&utm_medium=profile&utm_campaign=readme'
const START = '<!-- BLOG-POST-LIST:START -->'
const END = '<!-- BLOG-POST-LIST:END -->'
const NOTE = `<!-- Generated from ${FEED_URL} by .github/workflows/update-articles.yml — edits between these markers are overwritten. -->`

const readmePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md')
const checkOnly = process.argv.includes('--check')

function fail(message) {
  console.error(`update-articles: ${message}`)
  process.exit(1)
}

// Markdown link text breaks on unescaped brackets; titles are otherwise
// passed through as authored.
const escapeLinkText = (s) => s.replace(/([[\]])/g, '\\$1')

const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

function tag(item, name) {
  const match = item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  if (!match) return null
  const cdata = match[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/)
  return (cdata ? cdata[1] : decodeEntities(match[1])).trim()
}

function parseFeed(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map(([, item]) => {
      const title = tag(item, 'title')
      const link = tag(item, 'link')
      const pubDate = tag(item, 'pubDate')
      if (!title || !link || !pubDate) return null

      const date = new Date(pubDate)
      if (Number.isNaN(date.getTime())) return null

      return { title, link, date }
    })
    .filter(Boolean)
}

const formatDate = (date) =>
  date.toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

function formatItem({ title, link, date }) {
  // The feed emits bare canonical URLs; attribution params are added here so
  // profile clicks are attributable in GA4.
  const url = new URL(link)
  url.search = url.search ? `${url.search.slice(1)}&${UTM}` : UTM
  return `- [${escapeLinkText(title)}](${url.href}) — ${formatDate(date)}`
}

const response = await fetch(FEED_URL, {
  headers: { 'User-Agent': 'gruz0-readme-updater' },
}).catch((error) => fail(`could not fetch feed: ${error.message}`))

if (!response.ok) fail(`feed returned HTTP ${response.status}`)

const items = parseFeed(await response.text())

// Guard: a feed outage or a format change must never silently blank the list.
// Better to fail the workflow loudly and leave the last good README in place.
if (items.length === 0) fail('feed parsed to zero items — refusing to write')

const readme = readFileSync(readmePath, 'utf8')
const startIdx = readme.indexOf(START)
const endIdx = readme.indexOf(END)
if (startIdx === -1 || endIdx === -1) fail('markers not found in README.md')
if (endIdx < startIdx) fail('markers are in the wrong order in README.md')

const block = [
  START,
  NOTE,
  '',
  ...items.slice(0, COUNT).map(formatItem),
  '',
  END,
].join('\n')

const updated = readme.slice(0, startIdx) + block + readme.slice(endIdx + END.length)

if (updated === readme) {
  console.log(`update-articles: already up to date (${items.length} in feed)`)
  process.exit(0)
}

if (checkOnly) fail('README.md is out of date — run: node scripts/update-articles.mjs')

writeFileSync(readmePath, updated)
console.log(`update-articles: wrote ${Math.min(items.length, COUNT)} articles`)
