import type { ShareInviteInfo } from './types';

export interface ShareInviteDisplay {
  owner: string;
  recipient: string | null;
}

export function getShareInviteDisplay(invite: ShareInviteInfo): ShareInviteDisplay {
  return {
    owner: invite.owner_username?.trim() || invite.owner?.trim() || '',
    recipient: invite.shared_with_email?.trim() || null,
  };
}
