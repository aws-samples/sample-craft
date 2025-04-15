import asyncio
import functools
import os
from cachetools import cached,keys,Cache,TTLCache
from .logger_utils import get_logger
import threading

logger = get_logger(__name__)

DEFAULT_CACHE_TTL = int(os.environ.get("DEFAULT_CACHE_TTL","120"))
DEFAULT_CACHE_MAXSIZE = int(os.environ.get("DEFAULT_CACHE_MAXSIZE","32"))

def print_cache_info(info:str):
    if os.environ.get("LOG_CACHE_INFO","true").lower() in ('true','1'):
        logger.info(info)


def lru_cache_with_logging(
        cache: Cache =None,
        maxsize=DEFAULT_CACHE_MAXSIZE,
        ttl=DEFAULT_CACHE_TTL,
        key=keys.hashkey
    ):
    def decorator(func):
        _cache = cache 
        if _cache is None:
            _cache = TTLCache(maxsize=maxsize, ttl=ttl)
        lock = threading.Lock()
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            _key = key(*args, **kwargs)
            with lock:
                if _key in _cache:
                    value = _cache[_key]
                    print_cache_info(f'cache hit: args: {args},kwargs: {kwargs}')
                    return value
                print_cache_info(f'cache miss: args: {args},kwargs: {kwargs}')
                result = func(*args, **kwargs)
                _cache[_key] = result
                return result
        return wrapper
    return decorator


def alru_cache_with_logging(
        cache: Cache =None,
        maxsize=DEFAULT_CACHE_MAXSIZE,
        ttl=DEFAULT_CACHE_TTL,
        key=keys.hashkey
    ):
    def decorator(func):
        _cache = cache 
        if _cache is None:
            _cache = TTLCache(maxsize=maxsize, ttl=ttl)  # 600 seconds TTL
       
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            _key = key(*args, **kwargs)
            if _key in _cache:
                value = _cache[_key]
                print_cache_info(f'cache hit: args: {args},kwargs: {kwargs}')
                return value
            print_cache_info(f'cache miss: args: {args},kwargs: {kwargs}')
            result = await func(*args, **kwargs) 
            _cache[_key] = result
            return result
        return wrapper
    return decorator



