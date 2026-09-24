import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import type { MonthQuery, RangeQuery } from './finance.schemas.ts'
import * as reportService from './report.service.ts'

export async function summary(req: Request, res: Response) {
  const { month } = req.query as unknown as MonthQuery
  res.json(await reportService.monthSummary(authUserId(req), month))
}

export async function byCategory(req: Request, res: Response) {
  const { month } = req.query as unknown as MonthQuery
  res.json(await reportService.spendingByCategory(authUserId(req), month))
}

export async function monthly(req: Request, res: Response) {
  const { months, to } = req.query as unknown as RangeQuery
  res.json(await reportService.monthlyReport(authUserId(req), months, to))
}

export async function trend(req: Request, res: Response) {
  const { months, to } = req.query as unknown as RangeQuery
  res.json(await reportService.balanceTrend(authUserId(req), months, to))
}
