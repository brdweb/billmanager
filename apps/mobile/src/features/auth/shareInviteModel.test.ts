import { describe, expect, it } from 'vitest';

import { getShareInviteDisplay } from './shareInviteModel';

describe('getShareInviteDisplay', () => {
  const invite = {
    bill_name: 'Internet',
    bill_amount: 80,
    split_type: 'equal',
    split_value: null,
    my_portion: 40,
  };

  it('uses the explicit owner and recipient fields returned by current servers', () => {
    expect(getShareInviteDisplay({
      ...invite,
      owner_username: 'alice',
      owner: 'legacy-owner',
      shared_with_email: 'bob@example.com',
    })).toEqual({
      owner: 'alice',
      recipient: 'bob@example.com',
    });
  });

  it('falls back to the legacy owner alias without rendering an empty recipient', () => {
    expect(getShareInviteDisplay({ ...invite, owner: 'alice' })).toEqual({
      owner: 'alice',
      recipient: null,
    });
  });
});
