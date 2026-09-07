import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),release:vi.fn(),send:vi.fn()}));
vi.mock('../db/pool.js',()=>({pool:{getConnection:async()=>mocks}}));
vi.mock('../config.js',()=>({config:{APP_URL:'https://huddlepickem.com'}}));
vi.mock('./email.js',()=>({sendEmail:mocks.send}));
import { processEmailQueue } from './email-outbox.js';

describe('email delivery worker',()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.execute.mockResolvedValue([{},[]]);});
  function setup(message:Record<string,unknown>,eligible=true,optedIn=true) {
    mocks.query.mockImplementation(async(sql:string)=>{
      if(sql.includes('GET_LOCK')) return [[{acquired:1}],[]];
      if(sql.includes('SELECT * FROM email_outbox')) return [[message],[]];
      if(sql.includes('SELECT m.user_id')) return [eligible?[{user_id:1}]:[],[]];
      if(sql.includes('SELECT reminder_emails')) return [[{reminder_emails:optedIn,result_emails:optedIn}],[]];
      return [[],[]];
    });
  }
  const message={id:1,event_key:'welcome:1',recipient:'test@example.invalid',subject:'Welcome',body:'Hello',kind:'welcome',attempts:0};
  it('marks successful deliveries and releases the database lock',async()=>{
    setup(message);await processEmailQueue();
    expect(mocks.send).toHaveBeenCalledWith(message.recipient,'Welcome','Hello','<welcome:1@huddlepickem.com>');
    expect(mocks.execute.mock.calls.some(([sql])=>sql.includes('SET sent_at='))).toBe(true);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('keeps failed deliveries pending with a persisted retry delay',async()=>{
    setup(message);mocks.send.mockRejectedValue(new Error('SMTP down'));
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    await processEmailQueue();
    expect(mocks.execute.mock.calls.some(([sql])=>sql.includes('attempts=attempts+1'))).toBe(true);
    expect(mocks.execute.mock.calls.some(([sql])=>sql.includes('SET sent_at='))).toBe(false);
    expect(log).toHaveBeenCalled();log.mockRestore();
  });
  it('cancels reminders after a member submits, leaves, or the week locks',async()=>{
    setup({...message,kind:'reminder',user_id:1,group_id:1,week_id:1},false);
    await processEmailQueue();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledWith('UPDATE email_outbox SET cancelled_at=UTC_TIMESTAMP(3) WHERE id=?',[1]);
  });
  it('does not send when another server holds the worker lock',async()=>{
    mocks.query.mockResolvedValue([[{acquired:0}],[]]);await processEmailQueue();
    expect(mocks.send).not.toHaveBeenCalled();expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('cancels an already-queued results email when the user opts out',async()=>{
    setup({...message,kind:'results',user_id:1},true,false);
    await processEmailQueue();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledWith('UPDATE email_outbox SET cancelled_at=UTC_TIMESTAMP(3) WHERE id=?',[1]);
  });
  it('sends opted-in results with a working preference-page link',async()=>{
    setup({...message,kind:'results',user_id:1});await processEmailQueue();
    expect(mocks.send).toHaveBeenCalledWith(message.recipient,message.subject,expect.stringContaining('https://huddlepickem.com/support.html'),expect.any(String));
  });
});
