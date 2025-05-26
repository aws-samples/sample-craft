import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from 'react-oidc-context';
// import useWebSocket, { ReadyState } from 'react-use-websocket';
import { useAppDispatch, useAppSelector } from 'src/app/hooks';
import { setLatestUserMessage } from 'src/app/slice/cs-workspace';
// import ConfigContext from 'src/context/config-context';
import useAxiosWorkspaceRequest from 'src/hooks/useAxiosWorkspaceRequest';
import { BaseConfig, ChatMessageResponse, ChatMessageType } from 'src/types';
import { formatTime, initialSSEConnection } from 'src/utils/utils';
import { v4 as uuidv4 } from 'uuid';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import { useTranslation } from 'react-i18next';
import { ReadyState } from 'src/utils/const';

const UserMessage: React.FC = () => {
  const { t } = useTranslation();
  // const config = useContext(ConfigContext);
  const csWorkspaceState = useAppSelector((state) => state.csWorkspace);
  const dispatch = useAppDispatch();
  const auth = useAuth();
  const request = useAxiosWorkspaceRequest();
  const [message, setMessage] = useState('');
  const [messageList, setMessageList] = useState<ChatMessageType[]>([]);
  const [requestContent, setRequestContent] = useState<BaseConfig>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isSending, setIsSending] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const messagesRef = useRef<HTMLDivElement>(null);
  const [lastUserMessageId, setLastUserMessageId] = useState<string | null>(
    null,
  );

  const getMessageList = async () => {
    const response: ChatMessageResponse = await request({
      url: `/customer-sessions/${csWorkspaceState.currentSessionId}/messages`,
      method: 'get',
    });

    // 检查是否有新的用户消息
    const latestUserMessage = response.Items.filter(
      (msg) => msg.role === 'user',
    ).pop();

    if (
      latestUserMessage &&
      latestUserMessage.messageId !== lastUserMessageId
    ) {
      // 有新的用户消息，更新lastUserMessageId
      setLastUserMessageId(latestUserMessage.messageId);
      dispatch(setLatestUserMessage(latestUserMessage.content));
    }

    setMessageList(response.Items);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 处理消息区域的滚动事件
  const handleScroll = () => {
    if (!messagesRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = messagesRef.current;
    const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 50;

    // 只有当用户滚动到接近底部时，才重新启用自动滚动
    setShouldAutoScroll(isAtBottom);
  };

  // 当消息列表更新时滚动到底部
  useEffect(() => {
    if (shouldAutoScroll) {
      scrollToBottom();
    }
  }, [messageList, shouldAutoScroll]);

  const handleSend = async () => {
    if (!message.trim()) return;

    setIsSending(true);
    const content = {
      query: message,
      entry_type: 'common',
      session_id: csWorkspaceState.currentSessionId,
      user_id: auth.user?.profile?.sub,
      action: 'sendResponse',
    };

    try {
      setRequestContent(content);
      // sendMessage(JSON.stringify(sendMessageObj));
      setMessageList((prev) => [
        ...prev,
        {
          messageId: uuidv4(),
          role: 'agent',
          content: message,
          createTimestamp: new Date().toISOString(),
          additional_kwargs: {},
        },
      ]);
      setMessage('');
      // 发送消息后重新启用自动滚动
      setShouldAutoScroll(true);
    } finally {
      setIsSending(false);
    }
  };

  const readyState = initialSSEConnection("/ccp-stream",requestContent, (data) => {
    console.log('Received SSE message:', data);
  try {
    // const message = JSON.parse(data);
    // if (message.message_type === 'MONITOR') {
    //   setCurrentMonitorMessage((prev) => {
    //     return prev + (message?.message ?? '');
    //   });
    // } else {
    //   handleAIMessage(message);
    // }
  } catch (error) {
    console.error('Error parsing SSE message:', error);
  }
}, (err) =>{
  console.error('SSE failed', err);
})

  useEffect(() => {
    if (csWorkspaceState.autoSendMessage) {
      setIsSending(true);
      const sendMessageObj = {
        query: csWorkspaceState.autoSendMessage,
        entry_type: 'common',
        session_id: csWorkspaceState.currentSessionId,
        user_id: auth.user?.profile?.sub,
        action: 'sendResponse',
      };

      try {
        setRequestContent(sendMessageObj);
        setMessageList((prev) => [
          ...prev,
          {
            messageId: uuidv4(),
            role: 'agent',
            content: csWorkspaceState.autoSendMessage,
            createTimestamp: new Date().toISOString(),
            additional_kwargs: {},
          },
        ]);
        // 发送消息后重新启用自动滚动
        setShouldAutoScroll(true);
      } finally {
        setIsSending(false);
      }
    }
  }, [csWorkspaceState.autoSendMessage]);

  // useEffect(() => {
  //   if (lastMessage) {
  //     console.log(lastMessage);
  //   }
  // }, [lastMessage]);

  // 初始化 lastUserMessageId
  useEffect(() => {
    if (messageList.length > 0) {
      const lastUser = messageList.filter((msg) => msg.role === 'user').pop();
      if (lastUser) {
        setLastUserMessageId(lastUser.messageId);
      }
    }
  }, []);

  useEffect(() => {
    if (csWorkspaceState.currentSessionId) {
      getMessageList();

      let intervalId: any = null;

      // 只在非发送状态时启动轮询
      if (!isSending) {
        intervalId = setInterval(getMessageList, 2000);
      }

      return () => {
        if (intervalId) {
          clearInterval(intervalId);
        }
      };
    }
  }, [csWorkspaceState.currentSessionId, isSending]);

  return (
    <div className="user-message-container">
      <div className="messages" ref={messagesRef} onScroll={handleScroll}>
        {messageList.map((message) => (
          <div key={message.messageId} className={`message ${message.role}`}>
            <div className="message-content">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkHtml]}>
                {message.content}
              </ReactMarkdown>
              <span className="time">
                {formatTime(message.createTimestamp)}
              </span>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="input-area">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('typeMessage')}
          rows={3}
        />
        <button
          onClick={() => {
            handleSend();
          }}
          className="send-btn"
          disabled={readyState !== ReadyState.SUCCESS}
        >
          <span className="icon">💬</span>
          {t('button.send')}
        </button>
      </div>
    </div>
  );
};

export default UserMessage;
