import '@testing-library/jest-dom';
import { renderHook, act, waitFor, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  usePresence,
  presenceRoomFor,
  type PresenceUpdate,
} from './usePresence';
import { LivePresence } from '../components/LivePresence';

function fakeSocket() {
  const handlers = new Map<string, ((payload: PresenceUpdate) => void)[]>();
  let gone = false;

  return {
    on: vi.fn((event: string, handler: (payload: PresenceUpdate) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    off: vi.fn((event: string, handler?: (payload: PresenceUpdate) => void) => {
      const existing = handlers.get(event) ?? [];
      handlers.set(event, handler ? existing.filter((h) => h !== handler) : []);
    }),
    emit: vi.fn(),
    disconnect: vi.fn(() => {
      gone = true;
      handlers.clear();
    }),
    connected: true,
    push: (payload: PresenceUpdate) => {
      for (const h of handlers.get('presence') ?? []) h(payload);
    },
    handlerCount: (event: string) => (handlers.get(event) ?? []).length,
    get disconnected() {
      return gone;
    },
  };
}

describe('usePresence', () => {
  it('subscribes to the presence room and reports live viewers', () => {
    const socket = fakeSocket();
    const { result } = renderHook(() =>
      usePresence('mkt-1', {
        enabled: true,
        socketFactory: () => socket,
      }),
    );

    expect(socket.emit).toHaveBeenCalledWith('join', presenceRoomFor('mkt-1'));

    act(() => {
      socket.push({ viewers: 12 });
    });

    expect(result.current.viewers).toBe(12);
    expect(result.current.online).toBe(true);
    expect(result.current.connected).toBe(true);
  });

  it('falls back to polling when no socket is provided', async () => {
    const fetchViewers = vi
      .fn<(marketId: string) => Promise<number>>()
      .mockResolvedValue(7);

    const { result } = renderHook(() =>
      usePresence('mkt-2', {
        enabled: true,
        fetchViewers,
      }),
    );

    await waitFor(() => expect(result.current.viewers).toBe(7));
    expect(fetchViewers).toHaveBeenCalledWith('mkt-2');
    expect(result.current.connected).toBe(false);
  });

  it('cleans up the socket on unmount', () => {
    const socket = fakeSocket();
    const { unmount } = renderHook(() =>
      usePresence('mkt-3', {
        enabled: true,
        socketFactory: () => socket,
      }),
    );

    unmount();

    expect(socket.off).toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalled();
  });
});

describe('LivePresence', () => {
  it('renders the live count pill when a transport reports viewers', async () => {
    const socket = fakeSocket();

    render(
      <LivePresence
        marketId="mkt-4"
        socketFactory={() => socket}
      />,
    );

    act(() => {
      socket.push({ viewers: 12 });
    });

    expect(await screen.findByTestId('live-presence')).toHaveTextContent('12');
    expect(screen.getByText('live')).toBeInTheDocument();
  });

  it('renders nothing when there are no live viewers', () => {
    const socket = fakeSocket();

    const { container } = render(
      <LivePresence
        marketId="mkt-5"
        socketFactory={() => socket}
      />,
    );

    act(() => {
      socket.push({ viewers: 0 });
    });

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when no transport is provided (graceful fallback)', () => {
    const { container } = render(<LivePresence marketId="mkt-6" />);
    expect(container.firstChild).toBeNull();
  });
});
