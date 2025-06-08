import {
  Button,
  ExpandableSection,
  Grid,
  Popover,
  SpaceBetween,
  StatusIndicator,
} from '@cloudscape-design/components';
import React, { useState } from 'react';
import Avatar from 'react-avatar';
import ReactMarkdown from 'react-markdown';
import { BounceLoader } from 'react-spinners';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import BedrockImg from 'src/assets/bedrock.webp';
import './Message.css';
// import { DocumentData } from 'src/types';
import { SYS_ERROR_PREFIX } from 'src/utils/const';
import { useTranslation } from 'react-i18next';

interface MessageProps {
  type: 'ai' | 'human';
  message: {
    data: string;
    monitoring: string;
    // isError?: boolean;
  };
  showTrace?: boolean;
  aiSpeaking?: boolean;
  documentList?: string[];
}

const getFileIcon = (fileName: string): string => {
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'pdf':
      return 'pdf';
    case 'doc':
    case 'docx':
      return 'doc';
    case 'xls':
    case 'xlsx':
      return 'exel';
    case 'ppt':
    case 'pptx':
      return 'ppt';
    case 'html':
      return 'html';
    case 'png':
      return 'png';
    case 'jpg':
    case 'jpeg':
      return 'jpg';
    case 'txt':
      return 'txt';
    default:
      return 'file';
  }
};

const Message: React.FC<MessageProps> = ({
  showTrace,
  type,
  message,
  aiSpeaking,
  documentList,
}) => {
  const { t } = useTranslation();
  // const dispatch = useAppDispatch();
  const handleDocClick = (source: string) => {
    // dispatch(setActiveDocumentId(source));
    alert(source)
  };

  // console.log('documentList!!!!!', documentList);

  const [showCopyTooltip, setShowCopyTooltip] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.data).then(() => {
      setShowCopyTooltip(true);
      setTimeout(() => setShowCopyTooltip(false), 2000); // 2秒后隐藏提示
    });
  };

  const msgContent = message.data.replace(/~/g, '\\~')

  return (
    <>
      {type === 'ai' && (
        <>
          <div className="flex gap-10">
            {<Avatar size="40" round={true} src={BedrockImg} />}
            <div
              className={`message-content flex-1 ai`}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
            >
              <div className="message">
                {msgContent.startsWith(SYS_ERROR_PREFIX) && <StatusIndicator type="error">
                  <span style={{fontWeight: 'bold'}}>{t('systemError')}</span>
                </StatusIndicator>}
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {`${msgContent.replace(SYS_ERROR_PREFIX, '')}`}
                </ReactMarkdown>
                {aiSpeaking && (
                  <div className="mt-5">
                    <BounceLoader size="12px" color="#888" />
                  </div>
                )}
              </div>
              {documentList && documentList.length > 0 && (
                <div className="document-list">
                  <SpaceBetween direction='vertical' size='xs'>
                  <StatusIndicator type="info">
                  <span style={{fontWeight: 'bold'}}>{t('referenceDocuments')}</span>
                </StatusIndicator>
                <div>
                <Grid gridDefinition={[{
                  colspan: 6
                }, {
                  colspan: 6
                }]}>
                  {documentList.map((doc) => {
                    return (
                      
                      <div
                        key={doc}
                        className="document-item"
                        onClick={() => handleDocClick(doc)}
                      >
                      <SpaceBetween direction='horizontal' size='xs'>
                      <div style={{paddingTop: 2}}>
                        <img style={{width: '15px', height: '15px'}} src={`imgs/file/${getFileIcon(doc)}.png`} />
                      </div>
                      <div style={{fontSize: 14}}>{doc.split("/").pop()}</div>
                      </SpaceBetween>
                      </div>
                      // <div
                      //   key={doc.page_content}
                      //   className="document-item"
                      //   onClick={() => handleDocClick(doc.uuid)}
                      // >
                      //   <Icon name={iconName} />
                      //   <span className="doc-name" title={fileName}>
                      //     {fileName}
                      //   </span>
                      // </div>
                    );
                  })}</Grid></div></SpaceBetween>
                </div>
              )}
              {showTrace && message.monitoring && (
                <div className="monitor mt-10">
                  <ExpandableSection
                    variant="footer"
                    headingTagOverride="h5"
                    headerText="Monitoring"
                    defaultExpanded={true}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkHtml]}
                      components={{
                        h1: ({ node, ...props }) => (
                          <h1 className="custom-header" {...props} />
                        ),
                        h2: ({ node, ...props }) => (
                          <h2 className="custom-header" {...props} />
                        ),
                        h3: ({ node, ...props }) => (
                          <h3 className="custom-header" {...props} />
                        ),
                        table: ({ node, ...props }) => (
                          <table className="custom-table" {...props} />
                        ),
                        th: ({ node, ...props }) => (
                          <th className="custom-table-header" {...props} />
                        ),
                        td: ({ node, ...props }) => (
                          <td className="custom-table-cell" {...props} />
                        ),
                        img: ({ node, ...props }) => (
                          <img
                            {...props}
                            className="markdown-table-image"
                            style={{ maxWidth: '150px', height: 'auto' }}
                          />
                        ),
                      }}
                    >
                      {message.monitoring}
                    </ReactMarkdown>
                  </ExpandableSection>
                </div>
              )}
              {isHovered && (
                <div
                  className="message-actions"
                  style={{
                    position: 'absolute',
                    bottom: '0px',
                    right: '0px',
                    backgroundColor: 'rgba(242, 243, 243, 0.8)',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    zIndex: 1,
                  }}
                >
                  <div
                    className="feedback-buttons"
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      gap: '8px',
                    }}
                  >
                    <Popover
                      dismissButton={false}
                      position="top"
                      size="small"
                      triggerType="custom"
                      content={showCopyTooltip ? 'Copied!' : ''}
                    >
                      <Button
                        iconName="copy"
                        variant="icon"
                        onClick={handleCopy}
                        ariaLabel="copy"
                      />
                    </Popover>
                    {/* <Button
                      iconName="send"
                      variant="icon"
                      onClick={() => {
                        console.log('send');
                        dispatch(setAutoSendMessage(message.data));
                      }}
                      ariaLabel="send"
                    /> */}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {type === 'human' && (
        <div className="flex align-end gap-10">
          <div className={`message-content human`}>
            <div className="message">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.data}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Message;
