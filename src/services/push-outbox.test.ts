import { beforeEach,describe,expect,it,vi } from 'vitest';

const mocks=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),release:vi.fn(),send:vi.fn(),configured:vi.fn()}));
vi.mock('../db/pool.js',()=>({pool:{getConnection:async()=>mocks}}));
vi.mock('./apns.js',()=>({apnsConfigured:mocks.configured,sendApns:mocks.send}));
import { processPushQueue } from './push-outbox.js';

const message={id:7,user_id:4,category:'reminders',title:'Picks close soon',body:'Submit your picks',data:'{"weekId":3}',attempts:0,
  reminders:1,review_requests:1,decisions:1,results:1,group_activity:1};

describe('push delivery worker',()=>{
  beforeEach(()=>{
    vi.resetAllMocks();mocks.configured.mockReturnValue(true);mocks.execute.mockResolvedValue([{},[]]);
    mocks.query.mockImplementation(async(sql:string)=>{
      if(sql.includes('GET_LOCK'))return [[{acquired:1}],[]];
      if(sql.includes('FROM push_outbox'))return [[message],[]];
      if(sql.includes('FROM push_devices'))return [[{id:2,device_token:'a'.repeat(64)}],[]];
      return [[],[]];
    });
  });

  it('marks a successful APNs delivery as sent',async()=>{
    mocks.send.mockResolvedValue({status:200});
    await processPushQueue();
    expect(mocks.send).toHaveBeenCalledWith('a'.repeat(64),expect.objectContaining({aps:expect.any(Object),weekId:3}));
    expect(mocks.execute).toHaveBeenCalledWith('UPDATE push_outbox SET sent_at=UTC_TIMESTAMP(3) WHERE id=?',[7]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('removes a device token rejected by APNs',async()=>{
    mocks.send.mockResolvedValue({status:410,reason:'Unregistered'});
    await processPushQueue();
    expect(mocks.execute).toHaveBeenCalledWith('DELETE FROM push_devices WHERE id=?',[2]);
    expect(mocks.execute).toHaveBeenCalledWith('UPDATE push_outbox SET cancelled_at=UTC_TIMESTAMP(3) WHERE id=?',[7]);
  });

  it('does not touch the queue until APNs is configured',async()=>{
    mocks.configured.mockReturnValue(false);
    await processPushQueue();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
