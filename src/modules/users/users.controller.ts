import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ROLE } from '../../common/constants/roles.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { UsersQueryDto } from './users.dto.js';
import { UsersService } from './users.service.js';

@ApiBearerAuth()
@ApiTags('Users')
@Roles(ROLE.SUPER_ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async getUsers(@Query() query: UsersQueryDto, @Res() res: Response) {
    const result = await this.usersService.getUsers(query);
    res.status(result.status).json(result);
  }

  @Get(':uid')
  async getUser(@Param('uid') uid: string, @Res() res: Response) {
    const result = await this.usersService.getUser(uid);
    res.status(result.status).json(result);
  }

  @Patch('deactivate/:uid')
  async deactivateUser(
    @Param('uid') uid: string,
    @CurrentUser() authUser: AuthUser,
    @Res() res: Response,
  ) {
    const result = await this.usersService.deactivateUser(uid, authUser);
    res.status(result.status).json(result);
  }

  @Delete(':uid')
  async deleteUser(
    @Param('uid') uid: string,
    @CurrentUser() authUser: AuthUser,
    @Res() res: Response,
  ) {
    const result = await this.usersService.deleteUser(uid, authUser);
    res.status(result.status).json(result);
  }
}
