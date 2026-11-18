import type { IconName } from './icons';

export type HubTile = 'crew' | 'crewDocuments' | 'certificates' | 'reliefs' | 'voyage' | 'time' | 'survey' | 'particulars';

/**
 * The eight tiles of the Ship hub, in the order drawn. Kept apart from the hub screen so that the section bar, which is
 * on every Ship section screen, can name the tile without bringing the hub's code into the main chunk.
 */
export const HUB_TILES: readonly { id: HubTile; name: string; href: string; icon: IconName }[] = [
  { id: 'crew', name: 'Crew', href: '#/ship/crew', icon: 'crew' },
  { id: 'crewDocuments', name: 'Crew documents', href: '#/ship/crew-documents', icon: 'idCard' },
  { id: 'certificates', name: 'Certificates', href: '#/ship/certificates', icon: 'certificate' },
  { id: 'reliefs', name: 'Contracts & reliefs', href: '#/ship/reliefs', icon: 'swap' },
  { id: 'voyage', name: 'Voyage', href: '#/ship/voyage', icon: 'compass' },
  { id: 'time', name: "Ship's time", href: '#/ship/time', icon: 'clock' },
  { id: 'survey', name: 'Draft survey', href: '#/ship/survey', icon: 'draft' },
  { id: 'particulars', name: 'Particulars', href: '#/ship/particulars', icon: 'ship' },
];
