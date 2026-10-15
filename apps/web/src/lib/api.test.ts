import { describe, expect, it } from 'vitest';
import { apiUrl, baseUrl, mediaUrl } from './api';

describe('mediaUrl', () => {
  it('points relative API media at the configured API origin', () => {
    expect(mediaUrl('/api/v1/users/me/avatar')).toBe(apiUrl('/api/v1/users/me/avatar'));
    expect(mediaUrl('/api/v1/users/me/avatar')).toMatch(new RegExp(`^${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });

  it('preserves absolute and browser-native URLs', () => {
    expect(mediaUrl('https://cdn.example.com/avatar.png')).toBe('https://cdn.example.com/avatar.png');
    expect(mediaUrl('data:image/png;base64,AA==')).toBe('data:image/png;base64,AA==');
    expect(mediaUrl('blob:https://example.com/id')).toBe('blob:https://example.com/id');
  });

  it('omits missing media', () => {
    expect(mediaUrl(null)).toBeUndefined();
    expect(mediaUrl('')).toBeUndefined();
  });
});
