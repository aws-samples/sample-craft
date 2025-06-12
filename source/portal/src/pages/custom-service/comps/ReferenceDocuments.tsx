// import {
//   Alert,
//   ExpandableSection,
//   SpaceBetween,
// } from '@cloudscape-design/components';
// import { Document, Page } from 'react-pdf';
import React, { useEffect, useState } from 'react';
import { useAppSelector } from 'src/app/hooks';
// import ReactMarkdown from 'react-markdown';
// import remarkGfm from 'remark-gfm';
// import remarkHtml from 'remark-html';
import { useTranslation } from 'react-i18next';
import WordPreview from './viewers/WordViewer';
// import ConfigContext from 'src/context/config-context';
// import DocFileViewer from './DocFileViewer';
const ReferenceDocuments: React.FC = () => {
  const { t } = useTranslation();
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const csWorkspaceState = useAppSelector((state) => state.csWorkspace);
  
  // const s3 = new S3Client({ region: config?.oidcRegion });
  // const [pdfUrl, setPdfUrl] = useState('');
  // const [error, setError] = useState('');

  // useEffect(() => {
  //   fetch(`/api/preview-word?key=${encodeURIComponent(fileKey)}`)
  //     .then((res) => res.json())
  //     .then((data) => setPdfUrl(data.pdfUrl))
  // }, [fileKey]);

  useEffect(() => {
    if (csWorkspaceState.activeDocumentId) {
      setActiveDocId(csWorkspaceState.activeDocumentId);
    }
  }, [csWorkspaceState.activeDocumentId]);

  return (
    <div className="docs-tabs">
      <div className="tabs-list">
        {csWorkspaceState.documentList.map((doc) => (
         
          <button
            key={doc}
            className={`tab ${activeDocId === doc ? 'active' : ''}`}
            onClick={() => setActiveDocId(doc)}
          >
            <span className="title">{doc.split('/').pop()}</span>
            {activeDocId === doc && <span className="active-indicator" />}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {activeDocId ? (
          <div className="document-preview">
            <WordPreview fileKey={activeDocId} />
          </div>
        ) : (
          <div className="no-doc-selected">
            <p>{t('selectADocumentToPreview')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReferenceDocuments;
