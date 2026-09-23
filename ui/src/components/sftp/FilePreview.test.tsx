// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setLang } from '../../i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { previewTicketURL } = vi.hoisted(() => ({ previewTicketURL: vi.fn() }));
vi.mock('../../api/wsTicket', () => ({ previewTicketURL }));

import FilePreview from './FilePreview';

describe('FilePreview', () => {
  beforeEach(() => {
	setLang('en');
    previewTicketURL.mockReset().mockResolvedValue('/api/sftp/preview/7?ticket=short&path=%2Ftmp%2Funknown.bin');
  });

	afterEach(cleanup);

  it('uses a scoped preview URL and provides a safe unsupported fallback', async () => {
    render(<FilePreview connId={7} filePath="/tmp/unknown.bin" fileName="unknown.bin" onClose={vi.fn()} />);
    await screen.findByText(/not available for browser preview/i);
    expect(previewTicketURL).toHaveBeenCalledWith(7, '/tmp/unknown.bin');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(previewTicketURL).toHaveBeenCalledTimes(2));
  });

  it('keeps an oversized browser-parsed Office document out of the parser', async () => {
    render(<FilePreview connId={7} filePath="/tmp/large.xlsx" fileName="large.xlsx" size={26 * 1024 * 1024} onClose={vi.fn()} />);
    await screen.findByText(/exceeds the browser preview limit/i);
    expect(previewTicketURL).toHaveBeenCalledWith(7, '/tmp/large.xlsx');
  });
});
