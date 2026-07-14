import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatVideoSyncPlayerHostLabel,
  resolveYoutubeIframeApiSrc,
  resolveYoutubePlayerHostCandidates,
  resolveYoutubePlayerHostUrl,
} from './playerHosts.js'

void test('formatVideoSyncPlayerHostLabel names status bar hosts', () => {
  assert.equal(formatVideoSyncPlayerHostLabel('youtube-education'), 'YouTube Education')
  assert.equal(formatVideoSyncPlayerHostLabel('youtube-nocookie'), 'YouTube no-cookie')
  assert.equal(formatVideoSyncPlayerHostLabel('youtube'), 'YouTube')
  assert.equal(formatVideoSyncPlayerHostLabel(null), 'Not loaded')
})

void test('resolveYoutubePlayerHostUrl maps no-cookie, education, and standard hosts', () => {
  assert.equal(resolveYoutubePlayerHostUrl('youtube-nocookie'), 'https://www.youtube-nocookie.com')
  assert.equal(resolveYoutubePlayerHostUrl('youtube-education'), 'https://www.youtubeeducation.com')
  assert.equal(resolveYoutubePlayerHostUrl('youtube'), 'https://www.youtube.com')
})

void test('resolveYoutubeIframeApiSrc maps no-cookie and education hosts', () => {
  assert.equal(resolveYoutubeIframeApiSrc('youtube-nocookie'), 'https://www.youtube.com/iframe_api')
  assert.equal(resolveYoutubeIframeApiSrc('youtube-education'), 'https://www.youtubeeducation.com/iframe_api')
})

void test('resolveYoutubePlayerHostCandidates falls back from education to no-cookie to standard', () => {
  assert.deepEqual(resolveYoutubePlayerHostCandidates('youtube-education'), [
    {
      playerHost: 'youtube-education',
      hostUrl: 'https://www.youtubeeducation.com',
      iframeApiSrc: 'https://www.youtubeeducation.com/iframe_api',
    },
    {
      playerHost: 'youtube-nocookie',
      hostUrl: 'https://www.youtube-nocookie.com',
      iframeApiSrc: 'https://www.youtube.com/iframe_api',
    },
    {
      playerHost: 'youtube',
      hostUrl: 'https://www.youtube.com',
      iframeApiSrc: 'https://www.youtube.com/iframe_api',
    },
  ])
})

void test('resolveYoutubePlayerHostCandidates falls back from no-cookie to standard youtube.com', () => {
  assert.deepEqual(resolveYoutubePlayerHostCandidates('youtube-nocookie'), [
    {
      playerHost: 'youtube-nocookie',
      hostUrl: 'https://www.youtube-nocookie.com',
      iframeApiSrc: 'https://www.youtube.com/iframe_api',
    },
    {
      playerHost: 'youtube',
      hostUrl: 'https://www.youtube.com',
      iframeApiSrc: 'https://www.youtube.com/iframe_api',
    },
  ])
})

void test('resolveYoutubePlayerHostCandidates keeps standard youtube.com as a single host', () => {
  assert.deepEqual(resolveYoutubePlayerHostCandidates('youtube'), [
    {
      playerHost: 'youtube',
      hostUrl: 'https://www.youtube.com',
      iframeApiSrc: 'https://www.youtube.com/iframe_api',
    },
  ])
})
