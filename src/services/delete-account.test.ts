import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({verifyPassword:vi.fn()}));
vi.mock('../lib/password.js',()=>({verifyPassword:mocks.verifyPassword}));
import { deleteAccount } from './delete-account.js';

describe('account deletion',()=>{
  const query=vi.fn(),execute=vi.fn();
  const connection={query,execute} as never;
  beforeEach(()=>{vi.resetAllMocks();execute.mockResolvedValue([{},[]]);mocks.verifyPassword.mockResolvedValue(true);});

  it('transfers groups with members, removes empty groups, then deletes the user',async()=>{
    query.mockImplementation(async(sql:string,params:number[])=>{
      if(sql.startsWith('SELECT email')) return [[{email:'member@example.com',password_hash:'hash'}],[]];
      if(sql.startsWith('SELECT g.id')) return [[{id:10},{id:20}],[]];
      if(sql.startsWith('SELECT user_id')) return [params[0]===10?[{user_id:2}]:[],[]];
      return [[],[]];
    });
    await expect(deleteAccount(connection,1,'Password!1')).resolves.toEqual({transferredGroups:1,deletedGroups:1});
    expect(execute).toHaveBeenCalledWith("UPDATE group_members SET role='commissioner' WHERE group_id=? AND user_id=?",[10,2]);
    expect(execute).toHaveBeenCalledWith('UPDATE pool_groups SET created_by=? WHERE id=?',[2,10]);
    expect(execute).toHaveBeenCalledWith('DELETE FROM pool_groups WHERE id=?',[20]);
    expect(execute).toHaveBeenCalledWith('DELETE FROM email_outbox WHERE recipient=? OR user_id=?',['member@example.com',1]);
    expect(execute).toHaveBeenLastCalledWith('DELETE FROM users WHERE id=?',[1]);
  });

  it('rejects an incorrect password without deleting data',async()=>{
    query.mockResolvedValue([[{email:'member@example.com',password_hash:'hash'}],[]]);
    mocks.verifyPassword.mockResolvedValue(false);
    await expect(deleteAccount(connection,1,'wrong')).rejects.toEqual(expect.objectContaining({status:401,message:'Password is incorrect'}));
    expect(execute).not.toHaveBeenCalled();
  });
});
