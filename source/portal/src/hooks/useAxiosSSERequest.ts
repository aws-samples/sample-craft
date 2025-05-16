import { useContext, useEffect, useRef, useState } from 'react';
import ConfigContext, { Config } from 'src/context/config-context';
import { OIDC_PROVIDER, OIDC_STORAGE } from 'src/utils/const';
import { getCredentials, isTokenExpired } from 'src/utils/utils';
import { EventSourcePolyfill, Event, MessageEvent } from 'event-source-polyfill';

interface UseSSEOptions {
  path?: string;
  params?: string;
  onMessage?: (data: any) => void;
  onError?: (e: Event) => void;
  heartbeatEvent?: string;
  heartbeatIntervalMs?: number;
  reconnectIntervalMs?: number;
}

const useAxiosSSERequest = ({
  path = '/stream',
  params = '',
  onMessage,
  onError,
  heartbeatEvent = 'ping',
  heartbeatIntervalMs = 1000 * 5,
  reconnectIntervalMs = 1000 * 3,
}: UseSSEOptions) => {
  const [status, setStatus] = useState<'in-progress'|'success'|'error'>('in-progress');
  const eventSourceRef = useRef<EventSource | null>(null);
  const config = useContext(ConfigContext);
  const token = getCredentials();
  const authToken = `Bearer ${token.access_token || token.idToken}`;
  const oidcInfo = genHeaderOidcInfo(config)
  const lastPingRef = useRef(Date.now());
  const isClosingRef = useRef(false);

  if(isTokenExpired()){
    window.location.href = '/login'
    return null
  }

  useEffect(() => {
    if (params) {
      const isFirstConnection = !eventSourceRef.current;
      if (isFirstConnection) {
        setStatus('in-progress');
      }
      
      // Close existing connection if any
      if (eventSourceRef.current) {
        isClosingRef.current = true;
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      // const url = `http://${config?.albUrl}${path}?${params}&Authorization=${authToken}&Oidc-Info=${oidcInfo}`;
      const url = `${config?.oidcRedirectUrl.replace('/signin', '')}${path}?${params}`;
      // const es = new EventSource(url);
      const es = new EventSourcePolyfill(url,{
        headers: {
          'Authorization': authToken,
          'Oidc-Info': oidcInfo
        }
      });
      eventSourceRef.current = es;

      es.addEventListener(heartbeatEvent, () => {
        lastPingRef.current = Date.now();
        if (!isClosingRef.current) {
          setStatus('success');
        }
      });

      es.onmessage = (event: MessageEvent) => {
        onMessage?.(event.data);
      }

      es.onerror = (err: Event) => {
        console.error('SSE error:', err);
        const now = Date.now();
        if (now - lastPingRef.current > heartbeatIntervalMs && !isClosingRef.current) {
          setStatus('error');
        }
        onError?.(err);
      }

      const checkHeartbeat = setInterval(() => {
        const now = Date.now();
        if (now - lastPingRef.current > heartbeatIntervalMs && !isClosingRef.current) {
          setStatus('error');
        }
      }, reconnectIntervalMs);

      return () => {
        isClosingRef.current = true;
        if (es) {
          es.close();
        }
        clearInterval(checkHeartbeat);
        isClosingRef.current = false;
      };
    }
  }, [params]); 

  return status;
}

const genHeaderOidcInfo =(config: Config | null)=>{
  const oidc = JSON.parse(localStorage.getItem(OIDC_STORAGE) || '')
  switch(oidc.provider){
    case OIDC_PROVIDER.AUTHING:
      return JSON.stringify({
        provider: oidc?.provider,
        clientId: oidc?.clientId,
        redirectUri: oidc?.redirectUri,
      })
    default:
      return JSON.stringify({
        provider: oidc?.provider,
        clientId: config?.oidcClientId,
        poolId: config?.oidcPoolId,
    })
  }
}

export default useAxiosSSERequest;
