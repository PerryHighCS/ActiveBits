import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import { buildSoloDisplayedRoutes, sortRoutesByDistance } from './TSPStudent'

;(globalThis as { React?: typeof React }).React = React

void test('sortRoutesByDistance sorts ascending with nulls last', () => {
  const routes = [
    { id: 'a', type: 'student', distance: 22 },
    { id: 'b', type: 'student', distance: null },
    { id: 'c', type: 'student', distance: 10 },
  ]

  const result = sortRoutesByDistance(routes)
  assert.deepEqual(result.map((route) => route.id), ['c', 'a', 'b'])
})

void test('buildSoloDisplayedRoutes returns only active solo algorithm route', () => {
  const soloAlgorithms = {
    bruteForce: {
      name: 'Brute Force (Optimal)',
      route: ['city-0', 'city-1'],
      distance: 20,
      checked: 1,
      totalChecks: 1,
      cancelled: false,
      computeTime: 0.1,
    },
    heuristic: {
      name: 'Nearest Neighbor',
      route: ['city-1', 'city-0'],
      distance: 30,
      computeTime: 0.01,
    },
  }

  const bruteForceView = buildSoloDisplayedRoutes(true, 'bruteforce', soloAlgorithms)
  const heuristicView = buildSoloDisplayedRoutes(true, 'heuristic', soloAlgorithms)
  const disabledView = buildSoloDisplayedRoutes(false, 'bruteforce', soloAlgorithms)

  assert.deepEqual(bruteForceView.map((route) => route.id), ['bruteforce'])
  assert.deepEqual(heuristicView.map((route) => route.id), ['heuristic'])
  assert.deepEqual(disabledView, [])
})

void test('TSPStudent navigates to the session-ended route when its session ends', { concurrency: false }, async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://bits.example/tsp/session-1' })
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const previousHTMLElement = globalThis.HTMLElement
  const previousNode = globalThis.Node
  const previousWebSocket = globalThis.WebSocket
  const sockets: Array<{ emitMessage: (data: string) => void, close: () => void }> = []

  class TestWebSocket {
    onmessage: ((event: MessageEvent) => void) | null = null
    onopen: ((event: Event) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null
    private readonly messageListeners = new Set<(event: MessageEvent) => void>()

    constructor(_url: string) {
      sockets.push(this)
    }

    close(): void {}

    addEventListener(type: string, listener: (event: MessageEvent) => void): void {
      if (type === 'message') {
        this.messageListeners.add(listener)
      }
    }

    removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
      if (type === 'message') {
        this.messageListeners.delete(listener)
      }
    }

    emitMessage(data: string): void {
      const event = { data } as MessageEvent
      this.onmessage?.(event)
      for (const listener of this.messageListeners) {
        listener(event)
      }
    }
  }

  let cleanup: (() => void) | null = null
  let unmount: (() => void) | null = null

  try {
    ;(globalThis as { window?: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
    ;(globalThis as { document?: Document }).document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement
    globalThis.Node = dom.window.Node
    globalThis.WebSocket = TestWebSocket as unknown as typeof WebSocket
    dom.window.WebSocket = TestWebSocket as unknown as typeof WebSocket
    dom.window.localStorage.setItem('student-name-session-1', 'Student One')

    const { act, cleanup: testingLibraryCleanup, render, waitFor } = await import('@testing-library/react')
    cleanup = testingLibraryCleanup
    const { MemoryRouter, Route, Routes } = await import('react-router')
    const { default: TSPStudent } = await import('./TSPStudent.js')
    const rendered = render(React.createElement(
      MemoryRouter,
      { initialEntries: ['/tsp/session-1'] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/tsp/:sessionId',
          element: React.createElement(TSPStudent, { sessionData: { sessionId: 'session-1' } }),
        }),
        React.createElement(Route, { path: '/session-ended', element: React.createElement('p', null, 'Session ended') }),
      ),
    ))
    unmount = rendered.unmount

    await waitFor(() => assert.equal(sockets.length, 1))
    await act(async () => {
      sockets[0]?.emitMessage(JSON.stringify({ type: 'session-ended' }))
    })
    await waitFor(() => assert.match(dom.window.document.body.textContent ?? '', /Session ended/))
  } finally {
    unmount?.()
    cleanup?.()
    dom.window.close()
    ;(globalThis as { window?: Window & typeof globalThis }).window = previousWindow
    ;(globalThis as { document?: Document }).document = previousDocument
    globalThis.HTMLElement = previousHTMLElement
    globalThis.Node = previousNode
    globalThis.WebSocket = previousWebSocket
    if (previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor)
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator
    }
  }
})
