import asyncio

def run_coroutine_with_new_el(task):
    return asyncio.get_event_loop().run_until_complete(task)
