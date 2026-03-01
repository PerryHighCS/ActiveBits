import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MIXED_CONTENT_PRESENTATION_ERROR,
  SAFARI_LOOPBACK_PRESENTATION_ERROR,
  getStudentPresentationCompatibilityError,
  getPresentationUrlValidationError,
} from './presentationUrlCompatibility.js'

void test('getPresentationUrlValidationError rejects invalid URLs', () => {
  assert.equal(
    getPresentationUrlValidationError('javascript:alert(1)', 'https:'),
    'Presentation URL must be a valid http(s) URL',
  )
})

void test('getPresentationUrlValidationError rejects http presentations on https hosts', () => {
  assert.equal(
    getPresentationUrlValidationError('http://slides.example/deck.html', 'https:'),
    MIXED_CONTENT_PRESENTATION_ERROR,
  )
})

void test('getPresentationUrlValidationError allows localhost http presentations on https hosts', () => {
  assert.equal(
    getPresentationUrlValidationError('http://localhost:5500/deck.html', 'https:'),
    null,
  )

  assert.equal(
    getPresentationUrlValidationError('http://127.0.0.1:5500/deck.html', 'http:'),
    null,
  )
})

void test('getPresentationUrlValidationError allows loopback ip http presentations on https hosts', () => {
  assert.equal(
    getPresentationUrlValidationError('http://127.0.0.1:5500/deck.html', 'https:'),
    null,
  )

  assert.equal(
    getPresentationUrlValidationError('http://[::1]:5500/deck.html', 'https:'),
    null,
  )
})

void test('getPresentationUrlValidationError allows https presentations on https hosts', () => {
  assert.equal(
    getPresentationUrlValidationError('https://slides.example/deck.html', 'https:'),
    null,
  )
})

void test('getStudentPresentationCompatibilityError rejects Safari loopback http presentation on https host', () => {
  assert.equal(
    getStudentPresentationCompatibilityError({
      value: 'http://localhost:5500/deck.html',
      hostProtocol: 'https:',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    }),
    SAFARI_LOOPBACK_PRESENTATION_ERROR,
  )

  assert.equal(
    getStudentPresentationCompatibilityError({
      value: 'http://[::1]:5500/deck.html',
      hostProtocol: 'https:',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    }),
    SAFARI_LOOPBACK_PRESENTATION_ERROR,
  )
})

void test('getStudentPresentationCompatibilityError allows Chrome loopback http presentation on https host', () => {
  assert.equal(
    getStudentPresentationCompatibilityError({
      value: 'http://127.0.0.1:5500/deck.html',
      hostProtocol: 'https:',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    }),
    null,
  )
})
