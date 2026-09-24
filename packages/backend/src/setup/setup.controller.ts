import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { CreateAdminDto } from './dto/create-admin.dto';
import { SetupService } from './setup.service';
import { isEmbeddedMode } from '../common/utils/manifest-mode';

@Controller('api/v1/setup')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  @Public()
  @Get('status')
  async getStatus(): Promise<{
    needsSetup: boolean;
    socialProviders: string[];
    isSelfHosted: boolean;
    ollamaAvailable: boolean;
    localLlmHost: string;
    emailConfigured: boolean;
    mcpEnabled: boolean;
    embeddedMode: boolean;
  }> {
    const embeddedMode = isEmbeddedMode();
    const selfHosted = this.setupService.isSelfHosted();
    const ollamaAvailable =
      selfHosted && !embeddedMode ? await this.setupService.isOllamaAvailable() : false;
    return {
      needsSetup: await this.setupService.needsSetup(),
      socialProviders: this.setupService.getEnabledSocialProviders(),
      isSelfHosted: selfHosted,
      ollamaAvailable,
      localLlmHost: this.setupService.getLocalLlmHost(),
      emailConfigured: this.setupService.isEmailConfigured(),
      mcpEnabled: this.setupService.isMcpEnabled(),
      embeddedMode,
    };
  }

  @Public()
  @Post('admin')
  @HttpCode(HttpStatus.CREATED)
  async createAdmin(@Body() dto: CreateAdminDto): Promise<{ ok: true }> {
    if (isEmbeddedMode()) throw new NotFoundException();
    await this.setupService.createFirstAdmin(dto);
    return { ok: true };
  }
}
