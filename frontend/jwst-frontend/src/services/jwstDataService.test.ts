/**
 * Unit tests for jwstDataService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./apiClient', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
    postFormData: vi.fn(),
  },
}));

vi.mock('../utils/validationUtils', () => ({
  isValidObjectId: (id: string) => /^[a-f\d]{24}$/i.test(id),
}));

import { apiClient } from './apiClient';
import {
  getAll,
  upload,
  archive,
  unarchive,
  getDeletePreview,
  deleteObservation,
  getDeleteLevelPreview,
  deleteObservationLevel,
  archiveObservationLevel,
  scanAndImportMastFiles,
  getPixelData,
  getCubeInfo,
} from './jwstDataService';

const VALID_ID = '507f1f77bcf86cd799439011';
const INVALID_ID = 'invalid-id';

describe('jwstDataService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAll', () => {
    it('should GET /api/jwstdata with includeArchived=false by default', async () => {
      const mockData = [{ id: '1', fileName: 'test.fits' }];
      vi.mocked(apiClient.get).mockResolvedValue(mockData);

      const result = await getAll();

      expect(apiClient.get).toHaveBeenCalledWith('/api/jwstdata?includeArchived=false');
      expect(result).toEqual(mockData);
    });

    it('should GET /api/jwstdata with includeArchived=true when specified', async () => {
      vi.mocked(apiClient.get).mockResolvedValue([]);

      await getAll(true);

      expect(apiClient.get).toHaveBeenCalledWith('/api/jwstdata?includeArchived=true');
    });
  });

  describe('upload', () => {
    it('should POST form data to /api/jwstdata/upload', async () => {
      const mockResponse = { id: '123', fileName: 'test.fits' };
      vi.mocked(apiClient.postFormData).mockResolvedValue(mockResponse);

      const file = new File(['content'], 'test.fits', { type: 'application/fits' });
      const result = await upload(file, 'image');

      expect(apiClient.postFormData).toHaveBeenCalledWith(
        '/api/jwstdata/upload',
        expect.any(FormData)
      );

      const formData = vi.mocked(apiClient.postFormData).mock.calls[0][1] as FormData;
      expect(formData.get('File')).toBe(file);
      expect(formData.get('DataType')).toBe('image');
      expect(result).toEqual(mockResponse);
    });

    it('should include description when provided', async () => {
      vi.mocked(apiClient.postFormData).mockResolvedValue({});

      const file = new File(['content'], 'test.fits');
      await upload(file, 'image', 'A description');

      const formData = vi.mocked(apiClient.postFormData).mock.calls[0][1] as FormData;
      expect(formData.get('Description')).toBe('A description');
    });

    it('should include tags when provided', async () => {
      vi.mocked(apiClient.postFormData).mockResolvedValue({});

      const file = new File(['content'], 'test.fits');
      await upload(file, 'image', undefined, ['tag1', 'tag2']);

      const formData = vi.mocked(apiClient.postFormData).mock.calls[0][1] as FormData;
      expect(formData.getAll('Tags')).toEqual(['tag1', 'tag2']);
    });

    it('should not include description when undefined', async () => {
      vi.mocked(apiClient.postFormData).mockResolvedValue({});

      const file = new File(['content'], 'test.fits');
      await upload(file, 'spectral');

      const formData = vi.mocked(apiClient.postFormData).mock.calls[0][1] as FormData;
      expect(formData.get('Description')).toBeNull();
    });

    it('should not include tags when empty array', async () => {
      vi.mocked(apiClient.postFormData).mockResolvedValue({});

      const file = new File(['content'], 'test.fits');
      await upload(file, 'image', undefined, []);

      const formData = vi.mocked(apiClient.postFormData).mock.calls[0][1] as FormData;
      expect(formData.getAll('Tags')).toEqual([]);
    });
  });

  describe('archive', () => {
    it('should POST to /api/jwstdata/{dataId}/archive', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(undefined);

      await archive(VALID_ID);

      expect(apiClient.post).toHaveBeenCalledWith(`/api/jwstdata/${VALID_ID}/archive`);
    });

    it('should throw on invalid data ID', async () => {
      await expect(archive(INVALID_ID)).rejects.toThrow(`Invalid data ID: ${INVALID_ID}`);
      expect(apiClient.post).not.toHaveBeenCalled();
    });
  });

  describe('unarchive', () => {
    it('should POST to /api/jwstdata/{dataId}/unarchive', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(undefined);

      await unarchive(VALID_ID);

      expect(apiClient.post).toHaveBeenCalledWith(`/api/jwstdata/${VALID_ID}/unarchive`);
    });

    it('should throw on invalid data ID', async () => {
      await expect(unarchive(INVALID_ID)).rejects.toThrow(`Invalid data ID: ${INVALID_ID}`);
      expect(apiClient.post).not.toHaveBeenCalled();
    });
  });

  describe('getDeletePreview', () => {
    it('should DELETE /api/jwstdata/observation/{obsId}', async () => {
      const mockResponse = { observationBaseId: 'obs-1', files: [], totalSize: 0 };
      vi.mocked(apiClient.delete).mockResolvedValue(mockResponse);

      const result = await getDeletePreview('obs-1');

      expect(apiClient.delete).toHaveBeenCalledWith('/api/jwstdata/observation/obs-1');
      expect(result).toEqual(mockResponse);
    });

    it('should encode special characters in obsId', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({});

      await getDeletePreview('jw01234/obs+1');

      expect(apiClient.delete).toHaveBeenCalledWith(
        `/api/jwstdata/observation/${encodeURIComponent('jw01234/obs+1')}`
      );
    });
  });

  describe('deleteObservation', () => {
    it('should DELETE /api/jwstdata/observation/{obsId}?confirm=true', async () => {
      const mockResponse = { observationBaseId: 'obs-1', deletedCount: 5 };
      vi.mocked(apiClient.delete).mockResolvedValue(mockResponse);

      const result = await deleteObservation('obs-1');

      expect(apiClient.delete).toHaveBeenCalledWith('/api/jwstdata/observation/obs-1?confirm=true');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getDeleteLevelPreview', () => {
    it('should DELETE /api/jwstdata/observation/{obsId}/level/{level}', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ files: [] });

      await getDeleteLevelPreview('obs-1', 'L2a');

      expect(apiClient.delete).toHaveBeenCalledWith('/api/jwstdata/observation/obs-1/level/L2a');
    });

    it('should encode special characters', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({});

      await getDeleteLevelPreview('jw01234/obs', 'L2b');

      expect(apiClient.delete).toHaveBeenCalledWith(
        `/api/jwstdata/observation/${encodeURIComponent('jw01234/obs')}/level/L2b`
      );
    });
  });

  describe('deleteObservationLevel', () => {
    it('should DELETE with confirm=true', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ deletedCount: 3 });

      await deleteObservationLevel('obs-1', 'L3');

      expect(apiClient.delete).toHaveBeenCalledWith(
        '/api/jwstdata/observation/obs-1/level/L3?confirm=true'
      );
    });
  });

  describe('archiveObservationLevel', () => {
    it('should POST to archive endpoint', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ archivedCount: 2 });

      const result = await archiveObservationLevel('obs-1', 'L1');

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/jwstdata/observation/obs-1/level/L1/archive'
      );
      expect(result).toEqual({ archivedCount: 2 });
    });
  });

  describe('scanAndImportMastFiles', () => {
    it('should POST to /api/datamanagement/import/scan', async () => {
      const mockResponse = { imported: 10, skipped: 2 };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await scanAndImportMastFiles();

      expect(apiClient.post).toHaveBeenCalledWith('/api/datamanagement/import/scan', {});
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getPixelData', () => {
    it('should GET pixel data with default params', async () => {
      const mockResponse = { width: 100, height: 100, data: [] };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const result = await getPixelData(VALID_ID);

      expect(apiClient.get).toHaveBeenCalledWith(
        `/api/jwstdata/${VALID_ID}/pixeldata?maxSize=1200&sliceIndex=-1`
      );
      expect(result).toEqual(mockResponse);
    });

    it('should GET pixel data with custom params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({});

      await getPixelData(VALID_ID, 600, 5);

      expect(apiClient.get).toHaveBeenCalledWith(
        `/api/jwstdata/${VALID_ID}/pixeldata?maxSize=600&sliceIndex=5`
      );
    });

    it('should throw on invalid data ID', async () => {
      await expect(getPixelData(INVALID_ID)).rejects.toThrow(`Invalid data ID: ${INVALID_ID}`);
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('getCubeInfo', () => {
    it('should GET cube info', async () => {
      const mockResponse = { sliceCount: 10, axes: ['RA', 'DEC', 'WAVE'] };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const result = await getCubeInfo(VALID_ID);

      expect(apiClient.get).toHaveBeenCalledWith(`/api/jwstdata/${VALID_ID}/cubeinfo`);
      expect(result).toEqual(mockResponse);
    });

    it('should throw on invalid data ID', async () => {
      await expect(getCubeInfo(INVALID_ID)).rejects.toThrow(`Invalid data ID: ${INVALID_ID}`);
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });
});
