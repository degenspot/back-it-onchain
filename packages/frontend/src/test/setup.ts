import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock fetch if needed
global.fetch = vi.fn();

// Mock resize observer if needed
global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
}));
