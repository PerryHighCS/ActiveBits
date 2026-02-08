import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';

const DEFAULT_STAGE = 'gallery';

export type GalleryWalkStage = string;

export type GalleryWalkFeedbackEntry = Record<string, unknown> & {
  id?: string;
};

export type GalleryWalkRevieweeRecord = Record<string, unknown> & {
  name?: string;
  projectTitle?: string | null;
};

export type GalleryWalkReviewerRecord = Record<string, unknown> & {
  name?: string;
};

export type GalleryWalkReviewees = Record<string, GalleryWalkRevieweeRecord>;
export type GalleryWalkReviewers = Record<string, GalleryWalkReviewerRecord>;

interface GalleryWalkSessionData {
  stage?: unknown;
  feedback?: unknown;
  reviewees?: unknown;
  reviewers?: unknown;
  config?: unknown;
}

interface UseGalleryWalkSessionOptions {
  initialData?: GalleryWalkSessionData | null;
}

interface GalleryWalkSocketPayload {
  stage?: unknown;
  reviewees?: unknown;
  feedback?: unknown;
}

export interface GalleryWalkSocketMessage extends Record<string, unknown> {
  type?: string;
  payload?: GalleryWalkSocketPayload;
  stage?: unknown;
}

export interface UseGalleryWalkSessionResult {
  stage: GalleryWalkStage;
  setStage: Dispatch<SetStateAction<GalleryWalkStage>>;
  feedback: GalleryWalkFeedbackEntry[];
  setFeedback: Dispatch<SetStateAction<GalleryWalkFeedbackEntry[]>>;
  reviewees: GalleryWalkReviewees;
  setReviewees: Dispatch<SetStateAction<GalleryWalkReviewees>>;
  reviewers: GalleryWalkReviewers;
  setReviewers: Dispatch<SetStateAction<GalleryWalkReviewers>>;
  sessionTitle: string;
  setSessionTitle: Dispatch<SetStateAction<string>>;
  isLoading: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  refresh: () => Promise<void>;
  lastMessage: GalleryWalkSocketMessage | null;
}

interface BrowserLocationLike {
  protocol: string;
  host: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveStage(value: unknown): GalleryWalkStage {
  return typeof value === 'string' && value.length > 0 ? value : DEFAULT_STAGE;
}

function resolveTitle(config: unknown): string {
  if (!isPlainObject(config)) return '';
  return typeof config.title === 'string' ? config.title : '';
}

function normalizeFeedback(value: unknown): GalleryWalkFeedbackEntry[] {
  return Array.isArray(value) ? (value as GalleryWalkFeedbackEntry[]) : [];
}

function normalizeReviewees(value: unknown): GalleryWalkReviewees {
  return isPlainObject(value) ? (value as GalleryWalkReviewees) : {};
}

function normalizeReviewers(value: unknown): GalleryWalkReviewers {
  return isPlainObject(value) ? (value as GalleryWalkReviewers) : {};
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }
  return 'Failed to load session data';
}

export function buildGalleryWalkWsUrl(
  sessionId: string | null | undefined,
  location: BrowserLocationLike | null = typeof window !== 'undefined' ? window.location : null,
): string | null {
  if (!sessionId || !location) return null;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws/gallery-walk?sessionId=${sessionId}`;
}

export function parseGalleryWalkSocketMessage(rawData: unknown): GalleryWalkSocketMessage | null {
  if (typeof rawData !== 'string') return null;

  try {
    const parsed = JSON.parse(rawData);
    return isPlainObject(parsed) ? (parsed as GalleryWalkSocketMessage) : null;
  } catch {
    return null;
  }
}

export function getMessageStage(message: GalleryWalkSocketMessage): GalleryWalkStage {
  return resolveStage(message.payload?.stage ?? message.stage);
}

export function getMessageReviewees(message: GalleryWalkSocketMessage): GalleryWalkReviewees {
  return normalizeReviewees(message.payload?.reviewees);
}

export function getMessageFeedbackEntry(message: GalleryWalkSocketMessage): GalleryWalkFeedbackEntry | null {
  const feedback = message.payload?.feedback;
  return isPlainObject(feedback) ? (feedback as GalleryWalkFeedbackEntry) : null;
}

export function insertOrReplaceFeedbackEntry(
  previous: GalleryWalkFeedbackEntry[],
  entry: GalleryWalkFeedbackEntry,
): GalleryWalkFeedbackEntry[] {
  const next = previous.filter((item) => item.id !== entry.id);
  next.unshift(entry);
  return next;
}

export default function useGalleryWalkSession(
  sessionId: string | null | undefined,
  options: UseGalleryWalkSessionOptions = {},
): UseGalleryWalkSessionResult {
  const { initialData = null } = options;

  const [stage, setStage] = useState<GalleryWalkStage>(resolveStage(initialData?.stage));
  const [feedback, setFeedback] = useState<GalleryWalkFeedbackEntry[]>(
    normalizeFeedback(initialData?.feedback),
  );
  const [reviewees, setReviewees] = useState<GalleryWalkReviewees>(
    normalizeReviewees(initialData?.reviewees),
  );
  const [reviewers, setReviewers] = useState<GalleryWalkReviewers>(
    normalizeReviewers(initialData?.reviewers),
  );
  const [sessionTitle, setSessionTitle] = useState<string>(resolveTitle(initialData?.config));
  const [isLoading, setIsLoading] = useState<boolean>(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<GalleryWalkSocketMessage | null>(null);

  useEffect(() => {
    if (!initialData) return;
    setStage(resolveStage(initialData.stage));
    setFeedback(normalizeFeedback(initialData.feedback));
    setReviewees(normalizeReviewees(initialData.reviewees));
    setReviewers(normalizeReviewers(initialData.reviewers));
    setSessionTitle(resolveTitle(initialData.config));
    setIsLoading(false);
  }, [initialData]);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setStage(DEFAULT_STAGE);
      setFeedback([]);
      setReviewees({});
      setReviewers({});
      setSessionTitle('');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gallery-walk/${sessionId}/feedback`);
      if (!res.ok) {
        throw new Error('Failed to load session data');
      }

      const data = (await res.json()) as GalleryWalkSessionData;
      setStage(resolveStage(data.stage));
      setFeedback(normalizeFeedback(data.feedback));
      setReviewees(normalizeReviewees(data.reviewees));
      setReviewers(normalizeReviewers(data.reviewers));
      setSessionTitle(resolveTitle(data.config));
    } catch (err) {
      setError(resolveErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const buildWsUrl = useCallback(() => buildGalleryWalkWsUrl(sessionId), [sessionId]);

  const handleWsMessage = useCallback((event: MessageEvent) => {
    const message = parseGalleryWalkSocketMessage(event.data);
    if (!message) return;

    setLastMessage(message);
    if (message.type === 'stage-changed') {
      setStage(getMessageStage(message));
      return;
    }

    if (message.type === 'session-ended') {
      return;
    }

    if (message.type === 'reviewees-updated') {
      setReviewees(getMessageReviewees(message));
      return;
    }

    if (message.type === 'feedback-added') {
      const entry = getMessageFeedbackEntry(message);
      if (entry) {
        setFeedback((prev) => insertOrReplaceFeedbackEntry(prev, entry));
      }
    }
  }, []);

  const { connect: connectWs, disconnect: disconnectWs } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId),
    onMessage: handleWsMessage,
  });

  useEffect(() => {
    if (!sessionId) return undefined;
    connectWs();
    return () => disconnectWs();
  }, [sessionId, connectWs, disconnectWs]);

  return {
    stage,
    setStage,
    feedback,
    setFeedback,
    reviewees,
    setReviewees,
    reviewers,
    setReviewers,
    sessionTitle,
    setSessionTitle,
    isLoading,
    error,
    setError,
    refresh,
    lastMessage,
  };
}
