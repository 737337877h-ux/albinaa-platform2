'use client';
import Link from 'next/link';
import {Dialog} from '@/components/ui/dialog';
import {fmtMoney} from '@/lib/format';
import type {DebtChangeAccount} from './types';
import type {Dispatch,SetStateAction} from 'react';
type Accounts={currency:string;items:DebtChangeAccount[]}|null;
export function DebtChangeDialog({debtAccounts,setDebtAccounts}:{debtAccounts:Accounts;setDebtAccounts:Dispatch<SetStateAction<Accounts>>}){return (      <Dialog
        open={Boolean(debtAccounts)}
        onClose={() => setDebtAccounts(null)}
        title={`الحسابات المتأثرة — ${debtAccounts?.currency ?? ''}`}
        className="sm:max-w-5xl"
      >
        <p className="mb-3 text-xs text-concrete-500">
          مرتبة حسب أكبر تغير مطلق بين الاستيرادين. اضغط على اسم الحساب لفتح تفاصيله.
        </p>
        <div className="space-y-2 md:hidden">
          {debtAccounts?.items.map((account) => (
            <div key={`${account.customerId}-${account.currencyCode}-mobile`} className="rounded-xl border border-line p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/customers/${account.customerId}`}
                    onClick={() => setDebtAccounts(null)}
                    className="block truncate font-semibold text-pine-700 hover:underline dark:text-pine-200"
                  >
                    {account.customerName}
                  </Link>
                  <span className="tnum text-xs text-concrete-500" dir="ltr">{account.customerCode}</span>
                </div>
                <span
                  className={`tnum shrink-0 text-sm font-bold ${account.direction === 'increase' ? 'text-debt-600 dark:text-debt-400' : 'text-credit-600 dark:text-credit-400'}`}
                  dir="ltr"
                >
                  {account.change > 0 ? '+' : '−'}{fmtMoney(Math.abs(account.change))}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line pt-2 text-xs">
                <div>
                  <p className="text-concrete-500">الرصيد السابق</p>
                  <p className="tnum mt-0.5" dir="ltr">{fmtMoney(account.previousBalance)} {account.currencyCode}</p>
                </div>
                <div>
                  <p className="text-concrete-500">الرصيد الحالي</p>
                  <p className="tnum mt-0.5 font-semibold" dir="ltr">{fmtMoney(account.currentBalance)} {account.currencyCode}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-xl border border-line md:block">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-concrete-50 text-xs text-concrete-600 dark:bg-white/5 dark:text-concrete-300">
              <tr>
                <th className="px-3 py-2 text-right">الحساب</th>
                <th className="px-3 py-2 text-right">الكود</th>
                <th className="px-3 py-2 text-left">الرصيد السابق</th>
                <th className="px-3 py-2 text-left">الرصيد الحالي</th>
                <th className="px-3 py-2 text-left">التغير</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {debtAccounts?.items.map((account) => (
                <tr key={`${account.customerId}-${account.currencyCode}`} className="hover:bg-concrete-50/60 dark:hover:bg-white/5">
                  <td className="px-3 py-2.5 font-semibold">
                    <Link
                      href={`/customers/${account.customerId}`}
                      onClick={() => setDebtAccounts(null)}
                      className="text-pine-700 hover:underline dark:text-pine-200"
                    >
                      {account.customerName}
                    </Link>
                  </td>
                  <td className="tnum px-3 py-2.5 text-concrete-500" dir="ltr">{account.customerCode}</td>
                  <td className="tnum px-3 py-2.5 text-left" dir="ltr">{fmtMoney(account.previousBalance)} {account.currencyCode}</td>
                  <td className="tnum px-3 py-2.5 text-left" dir="ltr">{fmtMoney(account.currentBalance)} {account.currencyCode}</td>
                  <td
                    className={`tnum px-3 py-2.5 text-left font-bold ${account.direction === 'increase' ? 'text-debt-600 dark:text-debt-400' : 'text-credit-600 dark:text-credit-400'}`}
                    dir="ltr"
                  >
                    {account.change > 0 ? '+' : '−'}{fmtMoney(Math.abs(account.change))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Dialog>);}
