import { describe, expect, it } from 'vitest';
import { getGoogleConfigError } from '../src/config';

const config = { clientId: '123456-client.apps.googleusercontent.com', apiKey: 'test-key', appId: '123456' };

describe('Google Picker configuration', () => {
  it('accepts a numeric Cloud project number', () => {
    expect(getGoogleConfigError(config)).toBeUndefined();
  });
  it('rejects a textual project ID before opening Picker', () => {
    expect(getGoogleConfigError({ ...config, appId: 'exam-manager-project' })).toContain('numeric Google Cloud project number');
  });
  it('rejects incomplete configuration', () => {
    expect(getGoogleConfigError({ ...config, apiKey: undefined })).toContain('Add the three Google values');
  });
  it('treats example values as unconfigured', () => {
    expect(getGoogleConfigError({ ...config, appId: 'your-google-cloud-project-number' })).toContain('Add the three Google values');
  });
});
