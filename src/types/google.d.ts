export {};

declare global {
  interface Window {
    gapi: Gapi;
    google: GoogleIdentityAndPicker;
  }

  interface Gapi {
    load(api: string, options: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }): void;
  }

  interface GoogleIdentityAndPicker {
    accounts: {
      oauth2: {
        initTokenClient(config: TokenClientConfig): TokenClient;
        revoke(accessToken: string, done: () => void): void;
      };
    };
    picker: typeof PickerNamespace;
  }

  interface TokenClientConfig {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: unknown) => void;
  }

  interface TokenClient {
    callback: (response: TokenResponse) => void;
    requestAccessToken(options?: { prompt?: string }): void;
  }

  interface TokenResponse {
    access_token?: string;
    error?: string;
    error_description?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  }

  interface PickerResponse {
    [key: string]: unknown;
  }

  interface PickerDocument {
    [key: string]: unknown;
  }

  namespace PickerNamespace {
    const Action: {
      PICKED: string;
      CANCEL: string;
    };
    const Document: {
      ID: string;
      NAME: string;
      MIME_TYPE: string;
      THUMBNAILS: string;
      URL: string;
    };
    const DocsViewMode: {
      GRID: string;
      LIST: string;
    };
    const Feature: {
      MULTISELECT_ENABLED: string;
      NAV_HIDDEN: string;
    };
    const Response: {
      ACTION: string;
      DOCUMENTS: string;
    };
    const ViewId: {
      DOCS_IMAGES: string;
      DOCS: string;
      PDFS: string;
      FOLDERS: string;
    };

    class DocsView {
      constructor(viewId: string);
      setEnableDrives(enabled: boolean): DocsView;
      setIncludeFolders(includeFolders: boolean): DocsView;
      setMode(mode: string): DocsView;
      setMimeTypes(mimeTypes: string): DocsView;
      setParent(parentId: string): DocsView;
      setSelectFolderEnabled(selectFolderEnabled: boolean): DocsView;
    }

    class PickerBuilder {
      addView(view: DocsView): PickerBuilder;
      enableFeature(feature: string): PickerBuilder;
      setAppId(appId: string): PickerBuilder;
      setCallback(callback: (data: PickerResponse) => void): PickerBuilder;
      setDeveloperKey(key: string): PickerBuilder;
      setOAuthToken(token: string): PickerBuilder;
      setTitle(title: string): PickerBuilder;
      setOrigin(origin: string): PickerBuilder;
      setRelayUrl(url: string): PickerBuilder;
      setSelectableMimeTypes(mimeTypes: string): PickerBuilder;
      build(): Picker;
    }

    interface Picker {
      setVisible(visible: boolean): void;
    }
  }
}
