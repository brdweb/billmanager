import { describe, expect, it, vi } from 'vitest';

import { activateNotificationScope } from './notificationScope';

describe('activateNotificationScope', () => {
  it('re-reads the selected database after changing profiles', async () => {
    let profileId = 'server-a';
    let databaseId = 'family';
    const switchProfile = vi.fn(async () => {
      profileId = 'server-b';
      databaseId = 'business';
    });
    const selectDatabase = vi.fn(async (nextDatabase: string) => {
      databaseId = nextDatabase;
    });

    await activateNotificationScope(
      { serverProfileId: 'server-b', databaseId: 'family' },
      {
        getActiveProfileId: () => profileId,
        getCurrentDatabase: () => databaseId,
        switchProfile,
        selectDatabase,
      },
    );

    expect(switchProfile).toHaveBeenCalledWith('server-b');
    expect(selectDatabase).toHaveBeenCalledWith('family');
    expect(databaseId).toBe('family');
  });

  it('does not rewrite an already-active notification scope', async () => {
    const switchProfile = vi.fn();
    const selectDatabase = vi.fn();

    await activateNotificationScope(
      { serverProfileId: 'server-b', databaseId: 'family' },
      {
        getActiveProfileId: () => 'server-b',
        getCurrentDatabase: () => 'family',
        switchProfile,
        selectDatabase,
      },
    );

    expect(switchProfile).not.toHaveBeenCalled();
    expect(selectDatabase).not.toHaveBeenCalled();
  });
  it('rejects a reminder for the previous account before selecting a same-named database', async () => {
    const selectDatabase = vi.fn();
    await expect(activateNotificationScope(
      { serverProfileId: 'server', databaseId: 'family', principalId: '1' },
      { getActiveProfileId: () => 'server', getCurrentDatabase: () => 'other', getPrincipalId: () => '2',
        switchProfile: vi.fn(), selectDatabase },
    )).rejects.toThrow('another signed-in account');
    expect(selectDatabase).not.toHaveBeenCalled();
  });

});
