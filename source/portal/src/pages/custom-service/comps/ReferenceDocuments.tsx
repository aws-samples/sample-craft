import React, { useEffect, useState } from 'react';
import { useAppSelector } from 'src/app/hooks';
import { useTranslation } from 'react-i18next';
import WordPreview from './viewers/WordViewer';
import PDFPreview from './viewers/PDFViewer';

const ReferenceDocuments: React.FC = () => {
  const { t } = useTranslation();
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const csWorkspaceState = useAppSelector((state) => state.csWorkspace);
  

  useEffect(() => {
    if (csWorkspaceState.activeDocumentId) {
      setActiveDocId(csWorkspaceState.activeDocumentId);
    }
  }, [csWorkspaceState.activeDocumentId]);

  return (
    <div className="docs-tabs">
      {activeDocId ? (
        <>
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
        <div className="document-preview">
            {(activeDocId.endsWith('.docx')||activeDocId.endsWith('.doc')) ? (
                <WordPreview fileKey={activeDocId} />
            ) : (
                <PDFPreview fileKey={activeDocId} />
            )}
          </div>
        </div></>
        ) : (
          <div className="no-doc-selected">
            <p>{t('selectADocumentToPreview')}</p>
          </div>)}
    </div>
  );
};

export default ReferenceDocuments;
