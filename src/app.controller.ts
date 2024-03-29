declare function require(name: string): any;

import { Body, Controller, Get, Inject, Ip, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { AppService } from './app.service';
import { DataSource } from 'typeorm';
import * as sanitizeHtml from 'sanitize-html';
import { CACHE_MANAGER, Cache, CacheInterceptor } from '@nestjs/cache-manager';
import { Review } from './ReviewTypes';


// async function parseAddressSync(address: string): Promise<any> {
//   return await new Promise((res, rej) => {
//     parseAddress(address, (err: any, addressObj: any) => {
//       res(addressObj)
//     })
//   })
// }


@Controller()
@UseInterceptors(CacheInterceptor)
export class AppController {
  constructor(private readonly appService: AppService,
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private cacheManager: Cache) { }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }


  @Get("search")
  async searchAddress(@Query('address') query: string): Promise<SearchResult> {
    query = sanitizeHtml(query)


    return await this.appService.searchAddress(query, this.dataSource)

  }

  @Get("find")
  async searchLandlord(@Query('landlord') query: string): Promise<SearchResult> {
    query = sanitizeHtml(query)
    const result = await this.appService.searchLandlord(query, this.dataSource)
    console.log(query)
    return result
  }

  @Post("submit-review")
  async submitReview(@Ip() ip: string, @Body() review: Review) {
    console.log(ip)
    console.log(JSON.stringify(review, null, 2))
    await this.appService.submitReview(ip, review, this.dataSource)
  }


}
