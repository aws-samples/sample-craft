import { useContext, useEffect, useRef, useState } from 'react';
import ConfigContext, { Config } from 'src/context/config-context';
import { OIDC_PROVIDER, OIDC_STORAGE } from 'src/utils/const';
import { getCredentials, isTokenExpired } from 'src/utils/utils';

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

  if(isTokenExpired()){
    window.location.href = '/login'
    return null
  }


  useEffect(() => {
    const url = `http://${config?.albUrl}${path}?${params}&Authorization=${authToken}&Oidc-Info=${oidcInfo}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;
    setStatus('in-progress');

    es.addEventListener(heartbeatEvent, (event) => {
      lastPingRef.current = Date.now();
      setStatus('success');
    });

    es.onmessage = (event) => {
      onMessage?.(event.data);
    }

    es.onerror = (err) => {
      console.error('SSE error:', err);
      setStatus('error');
      onError?.(err);
    }

    const checkHeartbeat = setInterval(() => {
      const now = Date.now();
      if (now - lastPingRef.current > heartbeatIntervalMs) {
        setStatus('error');
      }
    }, reconnectIntervalMs);

    return () => {
      es.close();
      clearInterval(checkHeartbeat);
    };

    // const resetHeartbeat = () => {
    //   console.log('Resetting heartbeat timer');
    //   setStatus('success');
    //   if (heartbeatTimerRef.current) {
    //     clearTimeout(heartbeatTimerRef.current);
    //   }
    //   heartbeatTimerRef.current = setTimeout(() => {
    //     console.log('Heartbeat timeout triggered after', heartbeatIntervalMs, 'ms');
    //     setStatus('error');
    //   }, heartbeatIntervalMs);
    // };

    // es.onopen = () => {
    //   console.log('SSE connection opened');
    //   resetHeartbeat();
    // };

    // es.onmessage = (event) => {
    //   lastMsgRef.current = Date.now();
    //   console.log('Received SSE message:', event.data);
    //   // resetHeartbeat();
    //   // if (onMessage) {
    //   //   try {
    //   //     const data = JSON.parse(event.data);
    //   //     onMessage(data);
    //   //   } catch {
    //   //     onMessage(event.data);
    //   //   }
    //   // }
    // };

    // es.onerror = (err) => {
    //   console.error('SSE error:', err);
    //   setStatus('error');
    // };


    // const timer = setInterval(() => {
    //   if (Date.now() - lastMsgRef.current > heartbeatIntervalMs) {
    //     setStatus('error');
    //   } else {
    //     setStatus('success');
    //   }
    // }, reconnectIntervalMs);

    // const heartbeatInterval = setInterval(() => {
    //   const now = Date.now();
    //   // const timeSinceLastMessage = now - lastMessageRef.current;
    //   if (now - lastMessageRef.current > heartbeatIntervalMs) {
    //     setStatus('error');
    //   } else {
    //     setStatus('success');
    //   }
    // }, 5000);

    // es.addEventListener(heartbeatEvent, (event) => {
    //   console.log('Received heartbeat event:', event);
    //   resetHeartbeat();
    // });

    // es.onerror = (err) => {
    //   console.error('SSE error:', err);
    //   setStatus('error');
    //   if (onError) onError(err);

      // Attempt auto-reconnect after delay
    //   setTimeout(() => {
    //     setStatus('error'); // reconnect will be triggered by useEffect since `params` didn't change
    //   }, reconnectIntervalMs);
    // };

    return () => {
      es.close();
      clearInterval(checkHeartbeat);
    };
  }, [params]); 

  // const buildUrl = () => {
  //   const searchParams = new URLSearchParams();
  //   Object.entries(params).forEach(([key, value]) => {
  //     if (value !== undefined && value !== null) {
  //       searchParams.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  //     }
  //   });
  //   return `http://${config?.albUrl}${path}?${searchParams.toString()}`;
  // };

  // const resetHeartbeat = () => {
  //   if (heartbeatTimer.current) clearTimeout(heartbeatTimer.current);
  //   heartbeatTimer.current = setTimeout(() => {
  //     changeStates('error');
  //   }, heartbeatTimeoutMs);
  // };

  // // const connect = () => {
  //   const url = buildUrl();
  //   const token = getCredentials();
  //   const authToken = `Bearer ${token.access_token || token.idToken}`;
  //   const oidcInfo = genHeaderOidcInfo(config)
  //   if(isTokenExpired()){
  //     window.location.href = '/login'
  //     return null
  //   }

  //   if (esRef.current) {
  //     esRef.current.close();
  //   }

  //   // 'Authorization': `Bearer ${token.access_token || token.idToken}`,
  //   // 'Oidc-Info': genHeaderOidcInfo(config)

  //   const es = new EventSource(`${url}&Authorization=${authToken}&Oidc-Info=${oidcInfo}`);
  //   esRef.current = es;
  //   changeStates('connecting');
  //   resetHeartbeat();

  //   es.onopen = () => {
  //     console.log('[SSE] Connected to', url);
  //   };

  //   es.onmessage = (e) => {
  //     try {
  //       const parsed = JSON.parse(e.data);
  //       onMessage?.(parsed);
  //     } catch {
  //       onMessage?.(e.data);
  //     }
  //   };

  //   es.addEventListener('ping', () => {
  //     changeStates('ok');
  //     resetHeartbeat();
  //     onPing?.();
  //   });

  //   es.onerror = (e) => {
  //     console.error('[SSE] Connection error:', e);
  //     changeStates('error');
  //     onError?.(e);
  //     es.close();

  //     // 自动重连
  //     if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
  //     reconnectTimer.current = setTimeout(() => {
  //       console.log('[SSE] Attempting to reconnect...');
  //       connect();
  //     }, reconnectIntervalMs);
  //   };
  // };

  // useEffect(() => {
  //   connect();

  //   return () => {
  //     esRef.current?.close();
  //     if (heartbeatTimer.current) clearTimeout(heartbeatTimer.current);
  //     if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
  //   };
  // }, [path, JSON.stringify(params)]);

  // return { status };
  return status;
}



// import axios from 'axios';
// import { useContext } from 'react';
// import ConfigContext, { Config } from 'src/context/config-context';
// import { OIDC_PROVIDER, OIDC_STORAGE } from 'src/utils/const';
// import { alertMsg, getCredentials, isTokenExpired } from 'src/utils/utils';


// const useAxiosSSERequest = () => {
//   const config = useContext(ConfigContext);
  
//   const token = getCredentials();
//   const sendRequest = async ({
//     url = '',
//     method = 'get',
//     data = null,
//     headers = {},
//     params = {},
//   }: {
//     url: string;
//     method: 'get' | 'post' | 'put' | 'delete';
//     data?: any;
//     headers?: any;
//     params?: any;
//   }) => {
//     try {
//       if(isTokenExpired()){
//           window.location.href = '/login'
//           return null
//       }
//       const response = await axios({
//         method: method,
//         url: `http://${config?.albUrl}${url}`,
//         data: data,
//         params: params,
//         headers: {
//           ...headers,
//           'Authorization': `Bearer ${token.access_token || token.idToken}`,
//           'Oidc-Info': genHeaderOidcInfo(config)
//         },
//       });
//       console.log('Response headers:', response.headers);
//       return response.data;
//     } catch (error) {
//       if (error instanceof Error) {
//         alertMsg(error.message);
//       }
//       throw error;
//     }
//   };
//   return sendRequest;
// };

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
