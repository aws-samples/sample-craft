import asyncio

def run_coroutine_with_new_el(task):
    return asyncio.run(task)
    # loop = asyncio.new_event_loop()
    # return loop.run_until_complete(task)
