#!/usr/bin/env perl
use strict;
use warnings;
use Cwd qw(abs_path);
use File::Basename qw(dirname);
use File::Spec;

my $script = abs_path($0);
my $dir = dirname($script);
my $tool = File::Spec->catfile($dir, 'tools', 'download.pl');

exec $^X, $tool, @ARGV or die "Could not run $tool: $!\n";
